# NowPlaying Specification

YouTube Music の再生履歴を表示する NowPlaying 機能の仕様を定義します。再生データの収集、API インターフェース、UI 連携を Cloudflare + GitHub Actions で完結させます。

## 目的と範囲

- 最新から順に再生履歴を表示し、各アイテムにリアクションを付与できる。
- 再生履歴は自動収集し 90 日以内のみ保持。古いデータは削除する。
- 匿名アクセス前提、認証なし。

## アーキテクチャ

- 収集: Cloudflare Cron Trigger (12 時間間隔) で Worker を起動し、YouTube Data API にアクセス。トークン/リフレッシュトークンは KV/秘密で管理。
- ストレージ: D1 単一テーブルに非正規化保存 (`nowplaying`)。KV (`nowplaying:list:{offset}:{limit}`) を短期キャッシュ。リアクションは Reaction 仕様を利用。Cron で 90 日より古い行を削除。
- API: Hono (Pages Functions/Workers) が JSON を提供。CDN キャッシュ 6 時間。

## D1 データモデル

### nowplaying

再生履歴と曲メタを 1 行で保持します（非正規化）。90 日以上前は Cron で削除。

| column       | type       | note                                      |
| ------------ | ---------- | ----------------------------------------- |
| id           | uuid PK    | 再生イベント ID                           |
| video_id     | text       |                                           |
| title        | text       |                                           |
| artists      | json       | array                                     |
| album        | text       |                                           |
| image_url    | text       | `image/xyz` (スキーム/ドメインなしのパス) |
| played_at    | int (unix) | UTC                                       |
| created_at   | int (unix) |                                           |
| updated_at   | int (unix) |                                           |

インデックス:

- `played_at DESC`（最新再生順）
- `video_id`（同一曲集計や重複確認用）

## API インターフェース

共通レスポンス: `{ data: ... }` / `{ error: { code, message } }`。

| Method/Path                                  | Query/Body                                              | Response `data`                                    | Notes                                        |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| GET `/api/nowplaying`                        | Query: `offset` (default 0), `limit` (<=50, default 20) | `{ items: PlayWithTrack[], offset, limit, total }` | Cache `public, max-age=43200`。KV miss 時 D1 |
| GET `/api/nowplaying/:id`                    | -                                                       | `PlayWithTrack`                                    | 404 if not found                             |
| GET/POST `/api/reactions/nowplaying/:id`     | Reaction 仕様                                           | Reaction 仕様                                      | リアクション API 参照                        |

レスポンス例:

- GET `/api/nowplaying`

```json
{
  "data": {
    "items": [
      {
        "playId": "play_01HXYZ",
        "playedAt": 1735700000,
        "track": {
          "id": "track_abc",
          "videoId": "YOUTUBE123",
          "title": "Hello World",
          "artists": ["Sakura"],
          "album": "First Album",
          "imageUrl": "images/np/track_abc/art.jpg",
          "durationSec": 215
        },
        "reaction": { "👍": 3, "🎉": 1 }
      }
    ],
    "offset": 0,
    "limit": 20,
    "total": 200
  }
}
```

- GET `/api/nowplaying/:playId`

```json
{
  "data": {
    "playId": "play_01HXYZ",
    "playedAt": 1735700000,
    "track": {
      "id": "track_abc",
      "videoId": "YOUTUBE123",
      "title": "Hello World",
      "artists": ["Sakura"],
      "album": "First Album",
      "imageUrl": "images/np/track_abc/art.jpg",
      "durationSec": 215
    },
    "reaction": { "👍": 3, "🎉": 1 }
  }
}
```

## API クライアント契約

- TypeScript 例:

  ```ts
  type Track = { id: string; title: string; artists: string[]; album?: string; imageUrl?: string; durationSec?: number; videoId?: string }; // imageUrl is path-only (no https://)
  type Play = { playId: string; playedAt: number; track: Track; reaction?: Record<string, number> }; // playedAt is unix time (seconds)
  ```

- フロント: Home/NowPlaying ページは SSR で `GET /api/nowplaying?offset=0&limit=20` を埋め込み、スクロールで次ページをフェッチ。リアクションは Reaction API でトグル。

## 収集フロー詳細

- Cron Worker
  - 起動時に D1 `nowplaying` から 90 日より古いレコードを削除（TTL）。
  - KV に保存した `refresh_token` を用いアクセストークンを取得。
  - 直近 20 件の履歴を取得し、`played_at` が最新のものだけ挿入 (重複チェック: `nowplaying` の max `played_at`)。
  - エラーは Workers Queue `nowplaying-retry` に積んで再試行。

## キャッシュとパフォーマンス

- KV に一覧ページを保存 (`nowplaying:list:{offset}:{limit}`, `max-age=43200`)。KV にない場合のみ D1 にフォールバック。
- CDN キャッシュ 12 時間。検索/フィルタ機能は不要のため no-index。

## 監視・運用

- Workers Analytics Engine に Cron 成功/失敗、挿入件数を送信。
- 収集失敗が 3 回連続した場合に Slack/Webhook 通知。
- Google/YouTube API クォータの超過を防ぐため、1 回の Cron で 100 件以内、1 日 100 リクエスト以内に制限。
