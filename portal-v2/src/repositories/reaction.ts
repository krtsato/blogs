import { ReactionCounts, ReactionEventRow, ReactionTarget } from '../types/reaction';
import { sha256 } from '../utils/crypto';
import { Env } from '../env';
import { KV_KEYS } from '../constants/kvKeys';

const DEFAULT_EMOJIS = ['👍', '❤️', '🚀', '🎉', '🙏', '😂'];

const fingerprintHash = async (secret: string, ip: string | null, ua: string | null) =>
  sha256(`${secret}:${ip ?? 'none'}:${ua ?? 'none'}`);

export function allowedEmojis(env: Env): string[] {
  const custom = (env as any).REACTION_EMOJIS as string | undefined;
  if (custom) {
    return custom
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return DEFAULT_EMOJIS;
}

// counts を KV から取得（なければ空オブジェクト）
export async function getCountsKV(kv: KVNamespace, target: ReactionTarget): Promise<ReactionCounts> {
  const json = await kv.get(KV_KEYS.reactions(target.kind, target.id));
  return json ? (JSON.parse(json) as ReactionCounts) : {};
}

// counts を KV に保存
export async function putCountsKV(kv: KVNamespace, target: ReactionTarget, counts: ReactionCounts) {
  await kv.put(KV_KEYS.reactions(target.kind, target.id), JSON.stringify(counts));
}

// fingerprint 生成
export async function makeFingerprint(env: Env, ip: string | null, ua: string | null) {
  return fingerprintHash(env.ACCESS_TOKEN_SECRET, ip, ua);
}

// 最新のイベントを取得（fingerprint + emoji 単位）
export async function findLatestEvent(
  db: D1Database,
  target: ReactionTarget,
  fingerprint: string,
  emoji: string
): Promise<ReactionEventRow | null> {
  return db
    .prepare(
      `SELECT * FROM reaction_events
       WHERE target_kind = ? AND target_id = ? AND fingerprint = ? AND emoji = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(target.kind, target.id, fingerprint, emoji)
    .first<ReactionEventRow>();
}

// fingerprint に紐づく最新イベントを絵文字ごとに取得（N+1 回避）
export async function findLatestEventsByFingerprint(
  db: D1Database,
  target: ReactionTarget,
  fingerprint: string
): Promise<Record<string, ReactionEventRow>> {
  const rows = await db
    .prepare(
      `SELECT * FROM reaction_events
       WHERE target_kind = ? AND target_id = ? AND fingerprint = ?
       ORDER BY created_at DESC`
    )
    .bind(target.kind, target.id, fingerprint)
    .all<ReactionEventRow>();

  const map: Record<string, ReactionEventRow> = {};
  for (const row of rows.results ?? []) {
    if (!map[row.emoji]) {
      map[row.emoji] = row; // 最初に出現したものが最新
    }
  }
  return map;
}

// イベントを記録
export async function insertEvent(
  db: D1Database,
  target: ReactionTarget,
  emoji: string,
  fingerprint: string,
  action: 'add' | 'remove'
) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO reaction_events (id, target_kind, target_id, emoji, fingerprint, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), target.kind, target.id, emoji, fingerprint, action, now)
    .run();
}

// 対象ごとの KV カウントをまとめて取得
export async function queryCounts(kv: KVNamespace, targets: ReactionTarget[]): Promise<Record<string, ReactionCounts>> {
  const entries: Record<string, ReactionCounts> = {};
  await Promise.all(
    targets.map(async (t) => {
      entries[`${t.kind}:${t.id}`] = await getCountsKV(kv, t);
    })
  );
  return entries;
}
