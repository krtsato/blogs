import app from './app';
import type { Env } from './env';
import { cleanupOldNowPlaying, fetchAndInsertNowPlaying } from './cron/nowplaying-batch';
import { rebuildReactionSnapshots } from './cron/reaction-batch';

export default app;

// Cron Trigger 用（wrangler.toml に schedule を設定して利用）
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil(cleanupOldNowPlaying(env.DB));
  ctx.waitUntil(fetchAndInsertNowPlaying(env));
  ctx.waitUntil(rebuildReactionSnapshots(env));
};
