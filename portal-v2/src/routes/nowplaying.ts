import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { listNowplaying, getNowplaying } from '../repositories/nowplaying';
import { Play } from '../types/nowplaying';
import { KV_KEYS } from '../constants/kvKeys';

export const nowplayingRoutes = new Hono<{ Bindings: Env }>();

type ListResponse = { data: { items: Play[]; offset: number; limit: number; total: number } };
type DetailResponse = { data: Play };

const parseOffsetLimit = (query: (key: string) => string | undefined | null) => {
  const offset = Number(query('offset') ?? '0');
  const limit = Number(query('limit') ?? '20');
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    limit: Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20
  };
};

nowplayingRoutes.get('/nowplaying', async (c) => {
  const { offset, limit } = parseOffsetLimit((k) => c.req.query(k));
  const version = c.env.NOWPLAYING_KV ? (await c.env.NOWPLAYING_KV.get(KV_KEYS.nowplayingVersion)) ?? '0' : '0';
  const cacheKey = KV_KEYS.nowplayingList(version, offset, limit);

  if (c.env.NOWPLAYING_KV) {
    const cached = await c.env.NOWPLAYING_KV.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ListResponse['data'];
      return c.json<ListResponse>({ data: parsed });
    }
  }

  const items = await listNowplaying(c.env.DB, offset, limit);
  const data: ListResponse['data'] = { items, offset, limit, total: items.length };

  if (c.env.NOWPLAYING_KV) {
    await c.env.NOWPLAYING_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 60 * 60 * 12 }); // 12h
  }

  return c.json<ListResponse>({ data });
});

nowplayingRoutes.get('/nowplaying/:id', async (c) => {
  const id = c.req.param('id');
  const item = await getNowplaying(c.env.DB, id);
  if (!item) throw new HTTPException(404, { message: 'not found' });
  return c.json<DetailResponse>({ data: item });
});
