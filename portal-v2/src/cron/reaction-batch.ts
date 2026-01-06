import { Env } from '../env';
import { ReactionCounts } from '../types/reaction';
import { KV_KEYS } from '../constants/kvKeys';
import { subDays } from '../utils/time';

// reaction_events から集計し、KV に snapshot を再構築する
export async function rebuildReactionSnapshots(env: Env) {
  const lookbackDays = Number(env.REACTION_SNAPSHOT_DAYS ?? '30');
  const anomalyThreshold = Number(env.REACTION_ANOMALY_THRESHOLD ?? '20');
  const cutoff = Math.floor(subDays(Date.now(), lookbackDays) / 1000);
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
  const anomalies: string[] = [];
  const entries = Array.from(grouped.entries());
  const existingList = await Promise.all(
    entries.map(async ([key]) => {
      const [kind, id] = key.split(':');
      const existingJson = await env.REACTIONS_KV.get(KV_KEYS.reactions(kind, id));
      return existingJson ? (JSON.parse(existingJson) as ReactionCounts) : {};
    })
  );

  await Promise.all(
    entries.map(async ([key, counts], idx) => {
      const [kind, id] = key.split(':');
      const existing = existingList[idx];
      const diff = diffCounts(existing, counts);
      if (anomalyThreshold > 0 && exceedsThreshold(diff, anomalyThreshold)) {
        anomalies.push(`${key}:${JSON.stringify(diff)}`);
      }
      const payload = JSON.stringify(counts);
      await env.REACTIONS_KV.put(KV_KEYS.reactions(kind, id), payload);
    })
  );

  if (anomalies.length > 0) {
    await env.REACTIONS_KV.put(
      KV_KEYS.reactionAnomalyLog,
      JSON.stringify({ ts: Date.now(), anomalies }),
      { expirationTtl: 7 * 24 * 3600 }
    );
    console.warn('[reaction-batch] anomalies detected', anomalies.slice(0, 20));
  }
}

function diffCounts(before: ReactionCounts, after: ReactionCounts) {
  const emojis = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff: Record<string, number> = {};
  emojis.forEach((e) => {
    diff[e] = (after[e] ?? 0) - (before[e] ?? 0);
  });
  return diff;
}

function exceedsThreshold(diff: Record<string, number>, threshold: number) {
  return Object.values(diff).some((v) => Math.abs(v) >= threshold);
}
