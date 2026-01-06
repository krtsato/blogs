// 環境バインディングの型定義
export type Env = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ACCESS_TOKEN_SECRET: string; // メールリンク JWT 用
  RESEND_API_KEY: string;
  SLACK_SIGNING_SECRET: string;
  TURNSTILE_SECRET?: string;
  // R2 (attachments), KV (cache/rate-limit), Slack token, Vectorize など
  R2_ATTACHMENTS: R2Bucket;
  // KV キャッシュ等
  // KV_CACHE: KVNamespace;
  REACTIONS_KV: KVNamespace;
  VECTORIZE_INDEX: string;
  VECTORIZE_API_TOKEN: string;
  REACTION_SNAPSHOT_DAYS?: string;
  REACTION_ANOMALY_THRESHOLD?: string;
  // YouTube Data API での取得に利用（Cron 用）
  YOUTUBE_API_KEY: string;
  YOUTUBE_PLAYLIST_ID: string;
  NOWPLAYING_KV?: KVNamespace;
};
