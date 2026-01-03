# リアクション仕様

ブログ記事・ライト投稿 (Chat)・NowPlaying に付与する絵文字リアクションの仕様と API を定義します。Cloudflare KV をカウンタ、D1 をイベントログに利用し、Hono で API を提供します。

## 目的と範囲

- 対象: `articles/{slug}`, `chat/{id}`, `nowplaying/{playId}`。
- 絵文字セット: `👍, ❤️, 🚀, 🎉, 🙏, 😂` を基本。環境変数 `REACTION_EMOJIS` で拡張可能。
- 匿名でトグル可能、1 ユーザー1絵文字1回まで。fingerprint はサーバー側で UA/IP から生成し、クライアントは平文 fingerprint を送らない。

## アーキテクチャ

- ストレージ: KV (`reactions:{targetKind}:{targetId}` → `{ emoji: count }`) を即時反映。D1 (`reaction_events`) で冪等ログと監査。
- API: Cloudflare Pages Functions/Workers + Hono。
- レートリミット: KV による IP/UA ベース (10 req/分)。
- バックフィル: GitHub Actions から `reaction_events` を集計し KV を再構築するジョブを用意。

## D1 データモデル

### reaction_events

| カラム      | 型         | 備考                                |
| ----------- | ---------- | ----------------------------------- |
| id          | uuid PK    |                                     |
| target_kind | text       | 'article' \| 'chat' \| 'nowplaying' |
| target_id   | text       |                                     |
| emoji       | text       |                                     |
| fingerprint | text       | IP+UA ハッシュ                      |
| action      | text       | 'add' \| 'remove'                   |
| created_at  | int (unix) |                                     |

### reaction_snapshots

オプションの集計キャッシュ。

| カラム      | 型         | 備考 |
| ----------- | ---------- | ---- |
| target_kind | text       |      |
| target_id   | text       |      |
| emoji       | text       |      |
| count       | int        |      |
| updated_at  | int (unix) |      |

## API インターフェース

共通レスポンス: 成功 `{ data: ... }`、エラー `{ error: { code, message } }`。

| メソッド/パス                               | Query/Body                                                   | Response `data`                                                   | 備考                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET `/api/reactions/:targetKind/:targetId`  | Query: `-`                                                   | `{ counts: Record<string, number>, user: { reacted: string[] } }` | `targetKind` in `article\|chat\|nowplaying`。Cache `public, max-age=30`                  |
| POST `/api/reactions/:targetKind/:targetId` | Body `{ emoji: string, action?: "toggle"\|"add"\|"remove" }` | `{ counts: Record<string, number>, user: { reacted: string[] } }` | UA/IP からサーバーで fingerprint 生成。KV カウンタ更新後 D1 にイベント。レート超過は 429 |
| POST `/api/reactions/query`                 | Body `{ targets: { kind: string; id: string }[] }`           | `Record<string, Record<string, number>>` (key=`kind:id`)          | 一覧ページ用まとめ取得                                                                   |

ヘッダー: `User-Agent` と `CF-Connecting-IP` をサーバー側で参照し、HMAC で fingerprint を計算する。Cloudflare 環境前提で `CF-Connecting-IP` を信頼し、クライアントは fingerprint をボディに含めない。

レスポンス例:

- GET `/api/reactions/articles/hello-world`

```json
{
  "data": {
    "counts": { "👍": 3, "❤️": 1, "🎉": 2 },
    "user": { "reacted": ["👍"] }
  }
}
```

- POST `/api/reactions/query`

```json
{
  "data": {
    "article:hello-world": { "👍": 3, "❤️": 1 },
    "chat:abc123": { "👍": 1 }
  }
}
```

## API クライアント契約

- TypeScript 例:

  ```ts
  type ReactionCounts = Record<string, number>;
  type ReactionResponse = { counts: ReactionCounts; user: { reacted: string[] } };
  async function toggleReaction(targetKind: string, targetId: string, emoji: string) {
    const res = await fetch(`/api/reactions/${targetKind}/${targetId}`, { method: "POST", body: JSON.stringify({ emoji, action: "toggle" }) });
    return (await res.json()).data as ReactionResponse;
  }
  ```

- フロントは送信前に楽観的更新し、失敗時はロールバック。fingerprint は LocalStorage に保存して再利用。

## セキュリティ・運用

- フィンガープリント: IP+UA を HMAC でハッシュ化して保存し、生データを残さない。
- CORS: サイト Origin のみに限定。
- 監査: D1 イベントから 30 日以内の異常増加を検知し Slack 通知。
- KV 再計算: 1 日 1 回、`reaction_events` から `reaction_snapshots` を計算し KV を同期。
