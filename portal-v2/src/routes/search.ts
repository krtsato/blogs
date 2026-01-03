import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { searchAll } from '../repositories/search';
import { SearchResponse } from '../types/search';

export const searchRoutes = new Hono<{ Bindings: Env }>();

searchRoutes.get('/search', async (c) => {
  const q = c.req.query('query');
  if (!q || q.trim().length === 0) throw new HTTPException(400, { message: 'query is required' });

  const kinds = c.req.query('kinds');
  const modes = c.req.query('modes');
  const result = await searchAll(c.env, q, kinds ?? null, modes ?? null, (k) => c.req.query(k) ?? null);

  // 簡易に total を items.length として返却（本番は FTS COUNT や Vectorize topK を活用）
  const data: SearchResponse = {
    items: result.items,
    offset: result.offset,
    limit: result.limit,
    total: result.items.length
  };
  return c.json({ data });
});
