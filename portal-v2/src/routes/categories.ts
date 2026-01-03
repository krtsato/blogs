import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { listCategories, getCategory } from '../repositories/categories';

export const categoryRoutes = new Hono<{ Bindings: Env }>();

categoryRoutes.get('/categories', async (c) => {
  const { results } = await listCategories(c.env.DB);
  return c.json({ data: results ?? [] });
});

categoryRoutes.get('/categories/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await getCategory(c.env.DB, slug);
  if (!row) throw new HTTPException(404, { message: 'not found' });
  return c.json({ data: row });
});
