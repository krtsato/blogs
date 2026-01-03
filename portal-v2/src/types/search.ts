export type SearchModes = 'semantic' | 'lexical';
export type SearchKind = 'article' | 'chat';

export type SearchHit =
  | { type: 'article'; slug: string; title: string; excerpt: string; publishedAt: number }
  | { type: 'chat'; id: string; body: string; createdAt: number };

export type SearchResponse = {
  items: SearchHit[];
  offset: number;
  limit: number;
  total?: number;
};
