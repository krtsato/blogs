export type ReactionCounts = Record<string, number>;

export type ReactionResponse = {
  counts: ReactionCounts;
  user: { reacted: string[] };
};

export type ReactionTarget = {
  kind: 'article' | 'chat' | 'nowplaying';
  id: string;
};

export type ReactionEventRow = {
  id: string;
  target_kind: string;
  target_id: string;
  emoji: string;
  fingerprint: string;
  action: 'add' | 'remove';
  created_at: number;
};
