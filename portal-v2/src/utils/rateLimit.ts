import { KV_KEYS } from '../constants/kvKeys';

export type RateLimitConfig = {
  limit: number;
  windowSec: number;
};

// シンプルな KV ベースの固定窓レートリミット
export async function checkRateLimit(kv: KVNamespace | undefined, fingerprint: string, cfg: RateLimitConfig) {
  if (!kv) return true; // KV がない場合はスキップ
  const key = KV_KEYS.reactionRateLimit(fingerprint);
  const current = Number((await kv.get(key)) ?? '0');
  if (current >= cfg.limit) return false;
  await kv.put(key, String(current + 1), { expirationTtl: cfg.windowSec });
  return true;
}

// Hono 用ミドルウェアファクトリ。fingerprint 生成関数とレート設定を渡して利用する。
export function createRateLimitMiddleware<EnvBindings>(
  kv: KVNamespace | undefined,
  cfg: RateLimitConfig,
  getFingerprint: (c: import('hono').Context<any, any, any>) => Promise<string | null>
) {
  return async (c: import('hono').Context<any, any, any>, next: import('hono').Next) => {
    const fp = await getFingerprint(c);
    if (!fp) {
      await next();
      return;
    }
    const ok = await checkRateLimit(kv, fp, cfg);
    if (!ok) {
      return c.json({ error: { code: 'rate_limit', message: 'too many requests' } }, 429);
    }
    await next();
  };
}
