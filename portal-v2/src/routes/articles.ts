import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { parseOffsetLimit, listArticles, getArticleDetail, listComments, insertComment, softDeleteComment } from '../repositories/articles';
import { sha256 } from '../utils/crypto';
import { ArticleDetail } from '../types/articles';

// 記事・コメントのルーター
export const articleRoutes = new Hono<{ Bindings: Env }>();

articleRoutes.get('/articles', async (c) => {
  const { offset, limit } = parseOffsetLimit((k) => c.req.query(k));
  const category = c.req.query('category');
  const isFeatured = c.req.query('isFeatured') === 'true';
  const search = c.req.query('search');

  const items = await listArticles(c.env.DB, { offset, limit, category, isFeatured, search });
  return c.json({ data: { items, offset, limit, total: items.length } });
});

articleRoutes.get('/articles/:slug', async (c) => {
  const slug = c.req.param('slug');
  const includeComments = c.req.query('includeComments') === 'true';
  const detail = await getArticleDetail(c.env.DB, slug);
  if (!detail) throw new HTTPException(404, { message: 'not found' });

  const res: ArticleDetail = { ...detail };
  if (includeComments) {
    // コメントは別 API を推奨だが、必要ならここに含める実装を後続で追加できる
  }
  return c.json({ data: res });
});

articleRoutes.get('/articles/:slug/comments', async (c) => {
  const { offset, limit } = parseOffsetLimit((k) => c.req.query(k));
  const slug = c.req.param('slug');

  const article = await c.env.DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
  if (!article) throw new HTTPException(404, { message: 'not found' });

  const { results } = await listComments(c.env.DB, (article as any).id, offset, limit);
  return c.json({ data: { items: results ?? [], offset, limit, total: results?.length ?? 0 } });
});

articleRoutes.post('/articles/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json<{ nickname: string; body: string; email?: string }>();
  if (!body.nickname || !body.body) {
    throw new HTTPException(400, { message: 'nickname and body are required' });
  }
  const article = await c.env.DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
  if (!article) throw new HTTPException(404, { message: 'not found' });

  await insertComment(c.env.DB, {
    articleId: (article as any).id,
    nickname: body.nickname,
    body: body.body,
    email: body.email,
    fingerprint: '' // TODO: cf-connecting-ip/UA から生成
  });
  return c.json({ data: { ok: true } }, 201);
});

articleRoutes.delete('/articles/:slug/comments/:id', async (c) => {
  const slug = c.req.param('slug');
  const commentId = c.req.param('id');
  const article = await c.env.DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
  if (!article) throw new HTTPException(404, { message: 'not found' });

  await softDeleteComment(c.env.DB, { articleId: (article as any).id, commentId });
  return c.json({ data: { ok: true } });
});
