import { sha256 } from '../utils/crypto';
import { HTTPException } from 'hono/http-exception';

export type PricingRecord = Record<string, { amount: number; unit: string }>;

export type ArticlePricingRow = {
  id: string;
  pricing: string | null;
};

export type AccessRow = {
  expires_at: number | null;
};

// article_accesses への upsert（買い切り: expires_at は null）
export async function upsertArticleAccess(db: D1Database, articleId: string, email: string) {
  const emailHash = await sha256(email.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO article_accesses (id, article_id, email_hash, expires_at, created_at, payment_intent_id)
       VALUES (?, ?, ?, NULL, ?, NULL)
       ON CONFLICT(article_id, email_hash) DO UPDATE SET expires_at = excluded.expires_at, created_at = excluded.created_at`
    )
    .bind(crypto.randomUUID(), articleId, emailHash, now)
    .run();
}

// article_accesses の無効化（返金時など）
export async function revokeArticleAccess(db: D1Database, articleId: string, email: string) {
  const emailHash = await sha256(email.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE article_accesses SET expires_at = ? WHERE article_id = ? AND email_hash = ?`)
    .bind(now - 1, articleId, emailHash)
    .run();
}

// users の Stripe ID upsert
export async function upsertUserStripe(db: D1Database, email: string, stripeCustomerId: string | null | undefined) {
  if (!stripeCustomerId) return;
  const emailHash = await sha256(email.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, email_hash, user, created_at, updated_at)
       VALUES (?, ?, json_object('stripe', json_object('customer_id', ?)), ?, ?)
       ON CONFLICT(email_hash) DO UPDATE SET user = json_set(users.user, '$.stripe.customer_id', excluded.user->'stripe'->>'customer_id', updated_at = excluded.updated_at)`
    )
    .bind(crypto.randomUUID(), emailHash, stripeCustomerId, now, now)
    .run();
}

export async function findArticleBySlug(db: D1Database, slug: string): Promise<ArticlePricingRow | null> {
  return db.prepare('SELECT id, pricing FROM articles WHERE slug = ?').bind(slug).first<ArticlePricingRow>();
}

export async function findAccessByEmailHash(db: D1Database, articleId: string, emailHash: string): Promise<AccessRow | null> {
  return db
    .prepare(
      `SELECT expires_at FROM article_accesses WHERE article_id = ? AND email_hash = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(articleId, emailHash)
    .first<AccessRow>();
}

export async function resolveCurrency(pricingJson: string | null, currency?: string | null) {
  const map: PricingRecord = pricingJson ? JSON.parse(pricingJson) : {};
  const cur = currency ?? Object.keys(map)[0];
  if (!cur || !map[cur]) throw new HTTPException(400, { message: 'currency not available' });
  return { currency: cur, price: map[cur] };
}
