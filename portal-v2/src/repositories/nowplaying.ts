import { NowplayingRow, Play } from '../types/nowplaying';

const toPlay = (row: NowplayingRow): Play => ({
  playId: row.id,
  playedAt: row.played_at,
    track: {
      id: row.video_id,
      videoId: row.video_id,
      title: row.title,
      artists: row.artists ? JSON.parse(row.artists) : [],
      album: row.album ?? undefined,
      imageUrl: row.image_url ?? undefined
    },
    reaction: {} // Reaction は別サービスで取得
  });

export async function listNowplaying(db: D1Database, offset: number, limit: number): Promise<Play[]> {
  const { results } = await db
    .prepare(
      `SELECT id, video_id, title, artists, album, image_url, played_at, created_at, updated_at
       FROM nowplaying
       ORDER BY played_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<NowplayingRow>();
  return (results ?? []).map(toPlay);
}

export async function getNowplaying(db: D1Database, id: string): Promise<Play | null> {
  const row = await db
    .prepare(
      `SELECT id, video_id, title, artists, album, image_url, played_at, created_at, updated_at
       FROM nowplaying WHERE id = ?`
    )
    .bind(id)
    .first<NowplayingRow>();
  return row ? toPlay(row) : null;
}

export async function maxPlayedAt(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT MAX(played_at) as max_played_at FROM nowplaying`).first<{ max_played_at: number | null }>([] as any);
  return row?.max_played_at ?? 0;
}

export async function insertNowplayingRows(
  db: D1Database,
  rows: {
    id: string;
    video_id: string;
    title: string;
    artists: string[];
    album?: string | null;
    image_url?: string | null;
    duration_sec?: number | null;
    played_at: number;
  }[]
) {
  if (rows.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const statements = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO nowplaying (id, video_id, title, artists, album, image_url, played_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        r.id,
        r.video_id,
        r.title,
        JSON.stringify(r.artists),
        r.album ?? null,
        r.image_url ?? null,
        r.played_at,
        now,
        now
      )
  );
  await db.batch(statements);
}
