import { ChatDetail, ChatInsertParams, ChatSummary } from '../types/chat';

export type ChatRow = {
  id: string;
  body: string;
  nickname: string;
  attachments: string | null;
  source_kind: string;
  slack: string | null;
  is_deleted: number;
  created_at: number;
  updated_at: number;
};

export type ChatSearchRow = {
  chat_id: string;
  body_fts: string;
};

export async function listChats(db: D1Database, offset: number, limit: number): Promise<ChatSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, body, nickname, attachments, source_kind, slack, created_at, updated_at
       FROM chats
       WHERE is_deleted = 0
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<ChatRow>();

  return (results ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    nickname: row.nickname,
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
    sourceKind: row.source_kind as 'web' | 'slack',
    reaction: {}, // Reaction は別サービスで取得
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function insertChat(db: D1Database, params: ChatInsertParams): Promise<ChatDetail> {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const attachmentsJson = params.attachments ? JSON.stringify(params.attachments) : null;
  const slackJson = params.slack ? JSON.stringify(params.slack) : null;

  await db
    .prepare(
      `INSERT INTO chats (id, body, nickname, attachments, source_kind, slack, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(id, params.body, params.nickname, attachmentsJson, params.sourceKind, slackJson, now, now)
    .run();

  // 検索用 chat_searches を同期（簡易に本文そのままを token として格納）
  await db
    .prepare(
      `INSERT INTO chat_searches (chat_id, body_fts, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, params.body, now, now)
    .run();

  return {
    id,
    body: params.body,
    nickname: params.nickname,
    attachments: params.attachments ?? [],
    sourceKind: params.sourceKind,
    reaction: {},
    createdAt: now,
    updatedAt: now
  };
}

export async function softDeleteChat(db: D1Database, id: string) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`UPDATE chats SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id).run();
}

export async function findChatBySlackEvent(db: D1Database, eventId: string) {
  return db
    .prepare(`SELECT id FROM chats WHERE source_kind = 'slack' AND json_extract(slack, '$.event_id') = ? LIMIT 1`)
    .bind(eventId)
    .first<{ id: string }>();
}
