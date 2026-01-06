import { SearchHit, SearchKind, SearchModes } from '../types/search';
import type { Env } from '../env';

const MAX_LIMIT = 20;

type ArticleFTSRow = { slug: string; title: string; excerpt: string; published_at: number };
type ChatFTSRow = { id: string; body: string; created_at: number };
type ArticleHit = Extract<SearchHit, { type: 'article' }>;

const parseKinds = (kinds: string | null): SearchKind[] => {
  if (!kinds) return ['article', 'chat'];
  return kinds
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is SearchKind => k === 'article' || k === 'chat');
};

const parseModes = (modes: string | null): SearchModes[] => {
  if (!modes) return ['semantic', 'lexical'];
  return modes
    .split(',')
    .map((m) => m.trim())
    .filter((m): m is SearchModes => m === 'semantic' || m === 'lexical');
};

const parseOffsetLimit = (query: (key: string) => string | null) => {
  const offset = Number(query('offset') ?? '0');
  const limit = Number(query('limit') ?? '10');
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    limit: Number.isFinite(limit) && limit > 0 && limit <= MAX_LIMIT ? limit : MAX_LIMIT
  };
};

// D1 FTS（article メタ）
async function searchArticleFTS(db: D1Database, query: string, offset: number, limit: number): Promise<ArticleHit[]> {
  const { results } = await db
    .prepare(
      `SELECT slug, title, excerpt, published_at
       FROM article_searches
       WHERE title MATCH ? OR excerpt MATCH ?
       ORDER BY published_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(query, query, limit, offset)
    .all<ArticleFTSRow>();

  return (results ?? []).map((r) => ({
    type: 'article' as const,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    publishedAt: r.published_at
  }));
}

// D1 FTS（chat）
async function searchChatFTS(db: D1Database, query: string, offset: number, limit: number): Promise<SearchHit[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.body, c.created_at
       FROM chats c
       JOIN chat_searches cs ON cs.chat_id = c.id
       WHERE cs.body_fts MATCH ?
       AND c.is_deleted = 0
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(query, limit, offset)
    .all<ChatFTSRow>();

  return (results ?? []).map((r) => ({
    type: 'chat' as const,
    id: r.id,
    body: r.body,
    createdAt: r.created_at
  }));
}

// Vectorize semantic 検索（Article 本文）
async function searchArticleVectorize(env: Env, query: string, limit: number): Promise<ArticleHit[]> {
  // Cloudflare Vectorize API 呼び出し（簡易版: 直接 fetch）
  const res = await fetch(`https://api.cloudflare.com/client/v4/vectorize/indexes/${env.VECTORIZE_INDEX}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VECTORIZE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topK: limit,
      // テキストクエリのみ（埋め込み生成は Vectorize 側の text モードに委任）
      queries: [{ text: query }]
    })
  });
  if (!res.ok) {
    // 障害時は semantic を返さず空でフォールバック
    return [];
  }
  type VecHit = { id: string; score: number };
  const json = (await res.json()) as { result?: { matches?: VecHit[] }[] };
  const matches = json.result?.[0]?.matches ?? [];
  // id は article:{slug} フォーマットを想定
  return matches.map((m) => {
    const slug = m.id.replace(/^article:/, '');
    return { type: 'article' as const, slug, title: '', excerpt: '', publishedAt: 0 }; // メタは後で補完
  });
}

async function hydrateArticlesMeta(db: D1Database, slugs: string[]): Promise<Record<string, { title: string; excerpt: string; published_at: number }>> {
  if (slugs.length === 0) return {};
  const placeholders = slugs.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT slug, title, excerpt, published_at FROM article_searches WHERE slug IN (${placeholders})`)
    .bind(...slugs)
    .all<ArticleFTSRow>();
  const map: Record<string, { title: string; excerpt: string; published_at: number }> = {};
  (results ?? []).forEach((r) => {
    map[r.slug] = { title: r.title, excerpt: r.excerpt, published_at: r.published_at };
  });
  return map;
}

export async function searchAll(env: Env, q: string, kindsStr: string | null, modesStr: string | null, queryFn: (key: string) => string | null) {
  const kinds = parseKinds(kindsStr);
  const modes = parseModes(modesStr);
  const { offset, limit } = parseOffsetLimit(queryFn);

  const hits: SearchHit[] = [];

  // Article semantic
  const articleMap = new Map<string, ArticleHit>(); // slug -> hit
  if (kinds.includes('article') && modes.includes('semantic')) {
    const semanticHits = await searchArticleVectorize(env, q, limit);
    const slugSet = Array.from(new Set(semanticHits.map((h) => h.slug)));
    const metaMap = await hydrateArticlesMeta(env.DB, slugSet);
    semanticHits.forEach((h) => {
      const meta = metaMap[h.slug];
      if (meta) {
        h.title = meta.title;
        h.excerpt = meta.excerpt;
        h.publishedAt = meta.published_at;
      }
      articleMap.set(h.slug, h);
    });
  }

  // Article lexical
  if (kinds.includes('article') && modes.includes('lexical')) {
    const lexicalHits = await searchArticleFTS(env.DB, q, offset, limit);
    lexicalHits.forEach((hit) => {
      const existing = articleMap.get(hit.slug);
      if (existing) {
        // semantic に欠けるメタがあれば補完
        if (!existing.title) existing.title = hit.title;
        if (!existing.excerpt) existing.excerpt = hit.excerpt;
        if (!existing.publishedAt) existing.publishedAt = hit.publishedAt;
      } else {
        articleMap.set(hit.slug, hit as ArticleHit);
      }
    });
  }

  // Chat lexical
  if (kinds.includes('chat') && modes.includes('lexical')) {
    const chatHits = await searchChatFTS(env.DB, q, offset, limit);
    hits.push(...chatHits);
  }

  // Article の重複マージ結果を先頭に追加（semantic の順を優先）
  hits.unshift(...Array.from(articleMap.values()));

  return { items: hits, offset, limit };
}
