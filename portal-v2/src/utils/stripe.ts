import { HTTPException } from 'hono/http-exception';
import type Stripe from 'stripe';

// Checkout Session を取得する簡易ユーティリティ
export async function fetchStripeSession(secret: string, sessionId: string): Promise<Stripe.Checkout.Session> {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  if (!res.ok) throw new HTTPException(502, { message: 'stripe fetch failed' });
  return res.json<Stripe.Checkout.Session>();
}
