// KV キーを集約する定数
export const KV_KEYS = {
  reactions: (kind: string, id: string) => `reactions:${kind}:${id}`,
  nowplayingVersion: 'nowplaying:version',
  nowplayingEtag: 'nowplaying:etag',
  nowplayingList: (version: string | number, offset: number, limit: number) =>
    `nowplaying:list:v${version}:${offset}:${limit}`,
  reactionRateLimit: (fingerprint: string) => `ratelimit:reaction:${fingerprint}`,
  chatRateLimit: (fingerprint: string) => `ratelimit:chat:${fingerprint}`,
  reactionAnomalyLog: 'reaction:anomaly:last'
} as const;
