import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { listChats, insertChat, softDeleteChat, findChatBySlackEvent } from '../repositories/chat';
import { verifySlackSignature } from '../utils/slack';
import { ChatDetail, ChatSummary, AttachmentInput } from '../types/chat';
import { detectImageMeta } from '../utils/image';
import { checkRateLimit } from '../utils/rateLimit';
import { KV_KEYS } from '../constants/kvKeys';
import { verifyTurnstile } from '../utils/turnstile';
import { decode as decodeImage, Image } from 'imagescript';

export const chatRoutes = new Hono<{ Bindings: Env }>();

type ListResponse = { data: { items: ChatSummary[]; offset: number; limit: number; total: number } };
type CreateResponse = { data: { chat: ChatDetail } };
type SlackResponse = { data: { ok: true; chat?: ChatDetail } };
type DeleteResponse = { data: { deleted: true } };
type AttachmentUploadResponse = { data: { path: string } };
type CreatePayload = { body: string; nickname?: string; attachments?: AttachmentInput[]; turnstileToken?: string };

const parseOffsetLimit = (query: (key: string) => string | undefined | null) => {
  const offset = Number(query('offset') ?? '0');
  const limit = Number(query('limit') ?? '20');
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    limit: Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20
  };
};

// 添付の簡易バリデーション
function validateAttachments(attachments?: AttachmentInput[]) {
  if (!attachments) return;
  if (attachments.length > 3) throw new HTTPException(400, { message: 'attachments too many' });
  attachments.forEach((a) => {
    if (a.type !== 'image') throw new HTTPException(400, { message: 'only image allowed' });
    if (!a.path || a.path.startsWith('http')) throw new HTTPException(400, { message: 'path must be relative' });
  });
}

chatRoutes.get('/chat', async (c) => {
  const { offset, limit } = parseOffsetLimit((k) => c.req.query(k));
  const items = await listChats(c.env.DB, offset, limit);
  return c.json<ListResponse>({ data: { items, offset, limit, total: items.length } });
});

chatRoutes.post('/chat', async (c) => {
  const body = await c.req.json<CreatePayload>();
  const fingerprint = getFingerprint(c);
  const allowed = await checkRateLimit(
    c.env.REACTIONS_KV,
    fingerprint,
    { limit: 10, windowSec: 60 },
    KV_KEYS.chatRateLimit
  );
  if (!allowed) return c.json({ error: { code: 'rate_limit', message: 'too many requests' } }, 429);
  const turnstileOk = await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET, fingerprint);
  if (!turnstileOk) throw new HTTPException(400, { message: 'turnstile verification failed' });

  if (!body.body || body.body.length === 0 || body.body.length > 280) {
    throw new HTTPException(400, { message: 'body is required and must be <= 280 chars' });
  }
  validateAttachments(body.attachments);
  const nickname = body.nickname ?? 'anonymous';
  const chat = await insertChat(c.env.DB, {
    body: body.body,
    nickname,
    attachments: body.attachments,
    sourceKind: 'web'
  });
  return c.json<CreateResponse>({ data: { chat } }, 201);
});

// Slack 署名付き投稿
chatRoutes.post('/chat/slack', async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header('X-Slack-Signature');
  const ts = c.req.header('X-Slack-Request-Timestamp');
  await verifySlackSignature(rawBody, ts ?? null, sig ?? null, c.env.SLACK_SIGNING_SECRET);

  let text = '';
  let userId = 'slack';
  let eventId = '';
  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = JSON.parse(rawBody) as { event?: { text?: string; user?: string; client_msg_id?: string } };
    text = payload.event?.text ?? '';
    userId = payload.event?.user ?? 'slack';
    eventId = payload.event?.client_msg_id ?? '';
  } else {
    const params = new URLSearchParams(rawBody);
    text = params.get('text') ?? '';
    userId = params.get('user_id') ?? 'slack';
    eventId = params.get('trigger_id') ?? '';
  }

  if (!text || text.length > 280) {
    throw new HTTPException(400, { message: 'invalid slack text' });
  }
  if (eventId) {
    const dup = await findChatBySlackEvent(c.env.DB, eventId);
    if (dup) throw new HTTPException(409, { message: 'duplicate slack event' });
  }

  const chat = await insertChat(c.env.DB, {
    body: text,
    nickname: `slack:${userId}`,
    attachments: [],
    sourceKind: 'slack',
    slack: { user_id: userId, event_id: eventId || crypto.randomUUID() }
  });

  return c.json<SlackResponse>({ data: { ok: true, chat } });
});

chatRoutes.delete('/chat/:id', async (c) => {
  const id = c.req.param('id');
  await softDeleteChat(c.env.DB, id);
  return c.json<DeleteResponse>({ data: { deleted: true } });
});

// 画像アップロード (R2)。2MB 以内、画像のみ。パスは https を含めず返却。
chatRoutes.post('/chat/attachments', async (c) => {
  const ct = c.req.header('Content-Type') ?? '';
  if (!ct.startsWith('image/')) throw new HTTPException(400, { message: 'image only' });
  const lenHeader = c.req.header('Content-Length');
  if (lenHeader) {
    const len = Number(lenHeader);
    if (!Number.isFinite(len) || len > 2 * 1024 * 1024) {
      throw new HTTPException(400, { message: 'image too large (max 2MB)' });
    }
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > 2 * 1024 * 1024) throw new HTTPException(400, { message: 'image too large (max 2MB)' });

  const fingerprint = getFingerprint(c);
  const ok = await checkRateLimit(
    c.env.REACTIONS_KV,
    fingerprint,
    { limit: 5, windowSec: 60 },
    KV_KEYS.chatRateLimit
  );
  if (!ok) return c.json({ error: { code: 'rate_limit', message: 'too many uploads' } }, 429);

  const meta = detectImageMeta(buf);
  if (!meta) throw new HTTPException(400, { message: 'invalid image format' });

  // サーバー側で最大 1920px に収め、品質 90% の WebP として再エンコードする
  const decoded = await decodeImage(new Uint8Array(buf));
  if (!(decoded instanceof Image)) {
    throw new HTTPException(400, { message: 'animated image not supported' });
  }
  const maxSide = 1920;
  if (decoded.width > maxSide || decoded.height > maxSide) {
    const scale = Math.min(maxSide / decoded.width, maxSide / decoded.height);
    decoded.resize(Math.round(decoded.width * scale), Math.round(decoded.height * scale));
  }
  const encoded = await decoded.encodeWEBP(90);
  if (encoded.length > 2 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'image too large after encode (max 2MB)' });
  }

  const id = crypto.randomUUID();
  const key = `chat/${id}.webp`;

  await c.env.R2_ATTACHMENTS.put(key, encoded, {
    httpMetadata: { contentType: 'image/webp' }
  });

  return c.json<AttachmentUploadResponse>({ data: { path: `/${key}` } });
});

function getFingerprint(c: import('hono').Context<{ Bindings: Env }>) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  return ip;
}
