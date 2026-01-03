import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { fetchStripeSession } from '../utils/stripe';
import { verifyJwtHS256, sha256 } from '../utils/crypto';
import {
  upsertArticleAccess,
  revokeArticleAccess,
  upsertUserStripe,
  findArticleBySlug,
  findAccessByEmailHash,
  resolveCurrency
} from '../repositories/payments';
import type Stripe from 'stripe';
import StripeLib from 'stripe';

export const paymentRoutes = new Hono<{ Bindings: Env }>();

type CheckoutSessionRequest = {
  articleSlug: string;
  email?: string;
  currency?: string;
  successUrl?: string;
  cancelUrl?: string;
};

type CheckoutSessionResponse = { data: { url: string; sessionId: string } };
type OkResponse = { data: { ok: true } };
type AccessResponse = { data: { hasAccess: boolean; reason: string | null; expiresAt: number | null } };

// Checkout Session 作成
paymentRoutes.post('/payments/checkout-session', async (c) => {
  const body = await c.req.json<CheckoutSessionRequest>();
  if (!body.articleSlug) throw new HTTPException(400, { message: 'articleSlug is required' });

  const article = await findArticleBySlug(c.env.DB, body.articleSlug);
  if (!article) throw new HTTPException(404, { message: 'article not found' });

  const { currency, price } = await resolveCurrency(article.pricing, body.currency);
  const successUrl =
    body.successUrl ??
    `https://portal.sakurada.io/payments/success?session_id={CHECKOUT_SESSION_ID}&slug=${encodeURIComponent(
      body.articleSlug
    )}`;
  const cancelUrl = body.cancelUrl ?? `https://portal.sakurada.io/articles/${encodeURIComponent(body.articleSlug)}`;

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('currency', currency.toLowerCase());
  form.set('line_items[0][price_data][currency]', currency.toLowerCase());
  form.set('line_items[0][price_data][product_data][name]', body.articleSlug);
  form.set('line_items[0][price_data][unit_amount]', String(Math.round(price.amount * 100)));
  form.set('line_items[0][quantity]', '1');
  if (body.email) form.set('customer_email', body.email);
  form.set('metadata[slug]', body.articleSlug);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  if (!stripeRes.ok) throw new HTTPException(502, { message: 'stripe error' });
  const session = await stripeRes.json<Stripe.Checkout.Session>();
  if (!session.url) throw new HTTPException(502, { message: 'stripe session missing url' });
  return c.json<CheckoutSessionResponse>({ data: { url: session.url, sessionId: session.id } });
});

// success_url からの即時 upsert
paymentRoutes.post('/payments/success', async (c) => {
  const body = await c.req.json<{ sessionId: string; slug: string }>();
  if (!body.sessionId || !body.slug) throw new HTTPException(400, { message: 'sessionId and slug are required' });

  const session = await fetchStripeSession(c.env.STRIPE_SECRET_KEY, body.sessionId);
  const email = session?.customer_details?.email;
  if (!email) throw new HTTPException(400, { message: 'email not found in session' });

  const article = await findArticleBySlug(c.env.DB, body.slug);
  if (!article) throw new HTTPException(404, { message: 'article not found' });

  await upsertArticleAccess(c.env.DB, article.id, email);
  await upsertUserStripe(c.env.DB, email, typeof session.customer === 'string' ? session.customer : session.customer?.id);
  return c.json<OkResponse>({ data: { ok: true } });
});

// Stripe Webhook
paymentRoutes.post('/payments/webhook', async (c) => {
  const sig = c.req.header('Stripe-Signature');
  if (!sig) throw new HTTPException(400, { message: 'missing Stripe-Signature' });
  const raw = await c.req.text();

  let event: Stripe.Event;
  try {
    const stripe = new StripeLib(c.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(raw, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    throw new HTTPException(400, { message: 'invalid signature' });
  }

  const type = event.type;

  if (type === 'checkout.session.completed' || type === 'payment_intent.succeeded') {
    const session = event.data?.object as Stripe.Checkout.Session;
    const slug = session?.metadata?.slug;
    const email = session?.customer_details?.email;
    if (slug && email) {
      const article = await findArticleBySlug(c.env.DB, slug);
      if (article) {
        await upsertArticleAccess(c.env.DB, article.id, email);
        await upsertUserStripe(c.env.DB, email, typeof session.customer === 'string' ? session.customer : session.customer?.id);
      }
    }
  }

  if (type === 'charge.refunded' || type === 'charge.refund.updated') {
    const refundObj = event.data?.object as Stripe.Charge | undefined;
    const slug = refundObj?.metadata?.slug;
    const email = refundObj?.billing_details?.email;
    if (slug && email) {
      const article = await findArticleBySlug(c.env.DB, slug);
      if (article) {
        await revokeArticleAccess(c.env.DB, article.id, email);
      }
    }
  }

  return c.json<OkResponse>({ data: { ok: true } });
});

// アクセス判定
paymentRoutes.post('/articles/:slug/access', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json<{ email?: string; token?: string }>();
  const article = await findArticleBySlug(c.env.DB, slug);
  if (!article) throw new HTTPException(404, { message: 'article not found' });

  let emailHash: string | null = null;
  if (body.email) {
    emailHash = await sha256(body.email.toLowerCase());
  } else if (body.token) {
    const payload = await verifyJwtHS256(body.token, c.env.ACCESS_TOKEN_SECRET);
    emailHash = payload?.email_hash ?? null;
  }
  if (!emailHash) {
    return c.json({ data: { hasAccess: false, reason: 'email_or_token_required' } });
  }

  const access = await findAccessByEmailHash(c.env.DB, article.id, emailHash);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (access as any)?.expires_at as number | null | undefined;
  const hasAccess = !!access && (expiresAt === null || expiresAt === undefined || expiresAt > now);
  return c.json<AccessResponse>({
    data: {
      hasAccess,
      reason: hasAccess ? null : 'not_found',
      expiresAt: expiresAt ?? null
    }
  });
});
