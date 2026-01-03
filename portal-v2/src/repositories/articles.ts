import { ArticleDetail, ArticleSummary } from '../types/articles';
import { sha256 } from '../utils/crypto';

// オフセット/リミットの安全な取得
export const parseOffsetLimit = (query: (key: string) => string | undefined | null) => {
  const offset = Number(query('offset') ?? '0');
  const limit = Number(query('limit') ?? '20');
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    limit:
      Number.isFinite(limit) && limit > 0 && limit <= 50
        ? limit
        : 20
  };
};

export async function listArticles(db: D1Database, args: { offset: number; limit: number; category?: string | null; isFeatured?: boolean; search?: string | null; }): Promise<ArticleSummary[]> {
  const { offset, limit, category, isFeatured, search } = args;
  let base = `
    SELECT a.id, a.slug, a.title, a.excerpt, a.image_url, a.is_featured, a.pricing,
           a.published_at, IFNULL(ac.comment_count, 0) AS comment_count
    FROM articles a
    LEFT JOIN (
      SELECT article_id, COUNT(1) AS comment_count
      FROM comments
      WHERE is_deleted = 0
      GROUP BY article_id
    ) ac ON ac.article_id = a.id
  `;
  const conds: string[] = ['a.status = ?'];
  const params: any[] = ['published'];

  if (category) {
    base += ' JOIN article_categories acat ON acat.article_id = a.id JOIN categories cat ON cat.id = acat.category_id ';
    conds.push('cat.slug = ?');
    params.push(category);
  }
  if (isFeatured) {
    conds.push('a.is_featured = 1');
  }
  if (search) {
    conds.push('(a.title LIKE ? OR a.excerpt LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const order = 'ORDER BY a.published_at DESC';
  const page = 'LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.prepare(`${base} ${where} ${order} ${page}`).bind(...params).all();
  const items: ArticleSummary[] = (results ?? []).map((row: any) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    imageUrl: row.image_url ? JSON.parse(row.image_url) : {},
    categories: [], // カテゴリは後続で詰める
    publishedAt: row.published_at,
    isFeatured: !!row.is_featured,
    pricing: row.pricing ? JSON.parse(row.pricing) : {},
    reaction: {},
    commentCount: row.comment_count ?? 0
  }));

  // カテゴリを一括取得
  if (items.length > 0) {
    const ids = items.map((a) => a.id);
    const placeholders = ids.map(() => '?').join(',');
    const catRes = await db.prepare(
      `SELECT ac.article_id, cat.slug FROM article_categories ac JOIN categories cat ON cat.id = ac.category_id WHERE ac.article_id IN (${placeholders})`
    ).bind(...ids).all();
    const catMap = new Map<string, string[]>();
    (catRes.results ?? []).forEach((row: any) => {
      const list = catMap.get(row.article_id) ?? [];
      list.push(row.slug);
      catMap.set(row.article_id, list);
    });
    items.forEach((item) => {
      item.categories = catMap.get(item.id) ?? [];
    });
  }
  return items;
}

export async function getArticleDetail(db: D1Database, slug: string): Promise<ArticleDetail | null> {
  const stmt = db.prepare(`
    SELECT a.*, IFNULL(ac.comment_count, 0) AS comment_count
    FROM articles a
    LEFT JOIN (
      SELECT article_id, COUNT(1) AS comment_count
      FROM comments
      WHERE is_deleted = 0
      GROUP BY article_id
    ) ac ON ac.article_id = a.id
    WHERE a.slug = ?
  `);
  const row = (await stmt.bind(slug).first()) as any;
  if (!row) return null;

  const categoriesRes = await db.prepare(
    `SELECT cat.slug FROM article_categories ac JOIN categories cat ON cat.id = ac.category_id WHERE ac.article_id = ?`
  ).bind(row.id).all();

  const categories = (categoriesRes.results ?? []).map((r: any) => r.slug);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    imageUrl: row.image_url ? JSON.parse(row.image_url) : {},
    categories,
    publishedAt: row.published_at,
    isFeatured: !!row.is_featured,
    pricing: row.pricing ? JSON.parse(row.pricing) : {},
    reaction: {},
    commentCount: row.comment_count ?? 0,
    bodyHtml: null, // 本文は静的 JSON から取得予定
    paywall: row.pricing ? { required: true, reason: 'paid' } : null,
    permission: { read: !row.pricing, comment: true }, // Payment と統合後に置き換え
    readingTimeSec: row.reading_time_sec ?? 0,
    contentPath: row.content_path,
    updatedAt: row.updated_at
  };
}

export async function listComments(db: D1Database, articleId: string, offset: number, limit: number) {
  return db.prepare(
    `SELECT id, nickname, body, created_at FROM comments WHERE article_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(articleId, limit, offset).all();
}

export async function insertComment(db: D1Database, params: { articleId: string; nickname: string; body: string; email?: string; fingerprint?: string; }) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO comments (id, article_id, nickname, body, email_hash, created_at, is_deleted, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    crypto.randomUUID(),
    params.articleId,
    params.nickname,
    params.body,
    params.email ? await sha256(params.email.toLowerCase()) : null,
    now,
    params.fingerprint ?? ''
  ).run();
}

export async function softDeleteComment(db: D1Database, params: { articleId: string; commentId: string; }) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE comments SET is_deleted = 1, deleted_at = ? WHERE id = ? AND article_id = ?`
  ).bind(now, params.commentId, params.articleId).run();
}
