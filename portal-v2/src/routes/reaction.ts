import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import {
  allowedEmojis,
  getCountsKV,
  insertEvent,
  makeFingerprint,
  findLatestEvent,
  findLatestEventsByFingerprint,
  putCountsKV,
  queryCounts
} from '../repositories/reaction';
import { ReactionCounts, ReactionResponse, ReactionTarget } from '../types/reaction';
import { createRateLimitMiddleware } from '../utils/rateLimit';

export const reactionRoutes = new Hono<{ Bindings: Env }>();

type ReactionQueryResponse = { data: ReactionResponse };
type ReactionBulkResponse = { data: Record<string, ReactionCounts> };

const RATE_LIMIT = { limit: 10, windowSec: 60 }; // 10 req/min が目安

// 書き込み系のみレートリミットを適用
const reactionRateLimiter = async (c: any, next: any) => {
  const ua = c.req.header('User-Agent') ?? null;
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const fp = await makeFingerprint(c.env, ip, ua);
  return createRateLimitMiddleware(c.env.REACTIONS_KV, RATE_LIMIT, async () => fp)(c, next);
};

function parseTarget(params: { targetKind: string; targetId: string }): ReactionTarget {
  const kind = params.targetKind as ReactionTarget['kind'];
  if (!['article', 'chat', 'nowplaying'].includes(kind)) {
    throw new HTTPException(400, { message: 'invalid target kind' });
  }
  return { kind, id: params.targetId };
}

async function buildCounts(kv: KVNamespace, target: ReactionTarget): Promise<ReactionCounts> {
  const counts = await getCountsKV(kv, target);
  // 欠けている絵文字を 0 初期化（UI での扱いを簡素化）
  const normalized: ReactionCounts = {};
  for (const e of ['👍', '❤️', '🚀', '🎉', '🙏', '😂']) {
    normalized[e] = counts[e] ?? 0;
  }
  return { ...counts, ...normalized };
}

reactionRoutes.get('/reactions/:targetKind/:targetId', async (c) => {
  const target = parseTarget({ targetKind: c.req.param('targetKind'), targetId: c.req.param('targetId') });
  const counts = await buildCounts(c.env.REACTIONS_KV, target);

  // user.reacted を求めるため、最新イベントを emoji ごとに調べる
  const ua = c.req.header('User-Agent') ?? null;
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const fingerprint = await makeFingerprint(c.env, ip, ua);
  const latestMap = await findLatestEventsByFingerprint(c.env.DB, target, fingerprint);
  const reacted = Object.entries(latestMap)
    .filter(([, ev]) => ev && ev.action === 'add')
    .map(([emoji]) => emoji);

  return c.json<ReactionQueryResponse>({ data: { counts, user: { reacted } } });
});

reactionRoutes.post('/reactions/:targetKind/:targetId', reactionRateLimiter, async (c) => {
  const target = parseTarget({ targetKind: c.req.param('targetKind'), targetId: c.req.param('targetId') });
  const body = await c.req.json<{ emoji: string; action?: 'toggle' | 'add' | 'remove' }>();
  if (!body.emoji) throw new HTTPException(400, { message: 'emoji is required' });
  const allowed = allowedEmojis(c.env);
  if (!allowed.includes(body.emoji)) throw new HTTPException(400, { message: 'emoji not allowed' });

  const ua = c.req.header('User-Agent') ?? null;
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const fingerprint = await makeFingerprint(c.env, ip, ua);

  const counts = await buildCounts(c.env.REACTIONS_KV, target);
  const latest = await findLatestEvent(c.env.DB, target, fingerprint, body.emoji);
  let action: 'add' | 'remove';
  if (body.action === 'add' || body.action === 'remove') {
    action = body.action;
  } else {
    // toggle
    action = latest?.action === 'add' ? 'remove' : 'add';
  }

  if (action === 'add') {
    counts[body.emoji] = (counts[body.emoji] ?? 0) + 1;
  } else {
    counts[body.emoji] = Math.max(0, (counts[body.emoji] ?? 0) - 1);
  }

  await putCountsKV(c.env.REACTIONS_KV, target, counts);
  await insertEvent(c.env.DB, target, body.emoji, fingerprint, action);

  const reacted = action === 'add'
    ? Array.from(new Set([...(Object.keys(counts).filter((e) => e === body.emoji && action === 'add')), ...(latest?.action === 'add' ? [body.emoji] : [])]))
    : [];

  return c.json<ReactionQueryResponse>({ data: { counts, user: { reacted: action === 'add' ? [body.emoji] : [] } } });
});

reactionRoutes.post('/reactions/query', async (c) => {
  const body = await c.req.json<{ targets: { kind: string; id: string }[] }>();
  if (!body.targets || !Array.isArray(body.targets)) throw new HTTPException(400, { message: 'targets required' });
  const targets: ReactionTarget[] = body.targets.map((t) => parseTarget({ targetKind: t.kind, targetId: t.id }));
  const data = await queryCounts(c.env.REACTIONS_KV, targets);
  return c.json<ReactionBulkResponse>({ data });
});
