import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Env } from '../env';
import { listChats, insertChat, softDeleteChat, findChatBySlackEvent } from '../repositories/chat';
import { verifySlackSignature } from '../utils/slack';
import { ChatDetail, ChatSummary, AttachmentInput } from '../types/chat';

export const chatRoutes = new Hono<{ Bindings: Env }>();

type ListResponse = { data: { items: ChatSummary[]; offset: number; limit: number; total: number } };
type CreateResponse = { data: { chat: ChatDetail } };
type SlackResponse = { data: { ok: true; chat?: ChatDetail } };
type DeleteResponse = { data: { deleted: true } };
type AttachmentUploadResponse = { data: { path: string } };

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
  const body = await c.req.json<{ body: string; nickname?: string; attachments?: AttachmentInput[] }>();
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

  const id = crypto.randomUUID();
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const key = `chat/${id}.${ext}`;

  await c.env.R2_ATTACHMENTS.put(key, buf, {
    httpMetadata: { contentType: ct }
  });

  // リサイズはアップロード時に実施すべきだが、Workers 単体では困難なため、アップロード前にクライアント/別ワーカーでの処理を想定
  return c.json<AttachmentUploadResponse>({ data: { path: `/${key}` } });
});
