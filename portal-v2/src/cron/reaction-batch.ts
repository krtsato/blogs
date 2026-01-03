import { Env } from '../env';
import { ReactionCounts } from '../types/reaction';
import { KV_KEYS } from '../constants/kvKeys';
import { subDays } from '../utils/time';

const SNAPSHOT_LOOKBACK_DAYS = 30; // 直近 30 日のみ集計

// reaction_events から集計し、KV に snapshot を再構築する
export async function rebuildReactionSnapshots(env: Env) {
  const cutoff = Math.floor(subDays(Date.now(), SNAPSHOT_LOOKBACK_DAYS) / 1000);
  const { results } = await env.DB.prepare(
    `SELECT target_kind, target_id, emoji, COUNT(1) AS cnt
     FROM reaction_events
     WHERE created_at >= ?
     GROUP BY target_kind, target_id, emoji`
  ).bind(cutoff).all<{ target_kind: string; target_id: string; emoji: string; cnt: number }>();

  const grouped = new Map<string, ReactionCounts>();
  for (const row of results ?? []) {
    const key = `${row.target_kind}:${row.target_id}`;
    const counts = grouped.get(key) ?? {};
    counts[row.emoji] = row.cnt;
    grouped.set(key, counts);
  }

  // KV に保存
  for (const [key, counts] of grouped.entries()) {
    const [kind, id] = key.split(':');
    await env.REACTIONS_KV.put(KV_KEYS.reactions(kind, id), JSON.stringify(counts));
  }
}
