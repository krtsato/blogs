import { Env } from '../env';
import { KV_KEYS } from '../constants/kvKeys';
import { maxPlayedAt, insertNowplayingRows } from '../repositories/nowplaying';
import { YouTubePlaylistItem } from '../types/nowplaying';

const SECONDS_90_DAYS = 90 * 24 * 60 * 60;
const FETCH_LIMIT_PER_RUN = 100; // spec: 1 回の Cron で 100 件以内

// 90 日より古い nowplaying を削除する
export async function cleanupOldNowPlaying(db: D1Database) {
  const cutoff = Math.floor(Date.now() / 1000) - SECONDS_90_DAYS;
  await db.prepare(`DELETE FROM nowplaying WHERE played_at < ?`).bind(cutoff).run();
}

// YouTube Data API から最新再生を取得し、D1 に挿入する
export async function fetchAndInsertNowPlaying(env: Env) {
  const latest = await maxPlayedAt(env.DB);
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('playlistId', env.YOUTUBE_PLAYLIST_ID);
  url.searchParams.set('maxResults', String(FETCH_LIMIT_PER_RUN));
  url.searchParams.set('key', env.YOUTUBE_API_KEY);

  const headers: Record<string, string> = {};
  const etag = await env.NOWPLAYING_KV?.get(KV_KEYS.nowplayingEtag);
  if (etag) headers['If-None-Match'] = etag;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    // 失敗時はスキップ（Workers Analytics で監視想定）
    return;
  }
  if (res.status === 304) {
    // 変更なし
    return;
  }

  const json = (await res.json()) as { items?: YouTubePlaylistItem[]; nextPageToken?: string; etag?: string };

  const collected: NonNullable<ReturnType<typeof mapItem>>[] = [];
  if (json.items) collected.push(...mapItems(json.items, latest));

  let pageToken = json.nextPageToken;
  while (pageToken && collected.length < FETCH_LIMIT_PER_RUN) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set('pageToken', pageToken);
    const pageRes = await fetch(pageUrl.toString(), { headers });
    if (!pageRes.ok) break;
    const pageJson = (await pageRes.json()) as { items?: YouTubePlaylistItem[]; nextPageToken?: string };
    if (pageJson.items) collected.push(...mapItems(pageJson.items, latest));
    pageToken = pageJson.nextPageToken;
  }

  const rows = collected.slice(0, FETCH_LIMIT_PER_RUN);
  if (rows.length > 0) {
    await insertNowplayingRows(env.DB, rows);
    if (env.NOWPLAYING_KV) {
      const current = Number((await env.NOWPLAYING_KV.get(KV_KEYS.nowplayingVersion)) ?? '0');
      await env.NOWPLAYING_KV.put(KV_KEYS.nowplayingVersion, String(current + 1));
    }
  }

  if (json.etag && env.NOWPLAYING_KV) {
    await env.NOWPLAYING_KV.put(KV_KEYS.nowplayingEtag, json.etag);
  }
}

function mapItem(item: YouTubePlaylistItem, latest: number) {
  const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
  const playedAt = publishedAt ? Math.floor(new Date(publishedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
  if (playedAt <= latest) return null;
  return {
    id: crypto.randomUUID(),
    video_id: videoId,
    title: item.snippet?.title ?? '',
    artists: item.snippet?.videoOwnerChannelTitle ? [item.snippet.videoOwnerChannelTitle] : [],
    album: null,
    image_url: item.snippet?.thumbnails?.high?.url ? stripImageUrl(item.snippet.thumbnails.high.url) : null,
    played_at: playedAt
  };
}

function mapItems(items: YouTubePlaylistItem[], latest: number) {
  return items.map((i) => mapItem(i, latest)).filter((r): r is NonNullable<ReturnType<typeof mapItem>> => !!r);
}

// 画像 URL からスキーム/ドメインを取り除く（spec: https:// を保存しない）
function stripImageUrl(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return fullUrl;
  }
}
