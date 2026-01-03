# Chat Specification

ブログの短文投稿版 Chat API の仕様を定義します。Slack からも投稿でき、UI は Slack 風のメッセージバブルを想定します。サイト全体の概要は `site/spec.md` を参照。

## 目的と範囲

- 短文・軽量アップデートを時系列で共有する。
- Slack からの投稿と Web からの投稿を同一ストレージに集約。
- リアクションは Reaction 仕様の API を利用。

## アーキテクチャ

- ストレージ: D1 (`chats`, `chat_searches`, `slack_events`)。キャッシュ: KV (`cache:chat:list:{offset}:{limit}`)、添付画像は R2 に保存。
- API: Hono (Pages Functions) で `/api/chat` を提供。Slack コマンド/イベントを受け取るエンドポイントを Workers/Functions 上に配置。
- Slack 連携: Slash コマンド or Slack App の Incoming Webhook → API が `chats` に保存。管理者以外も Slack から投稿可能。
- UI: Slack テイストのバブル。ニックネーム + アバター (オプション画像) + 本文 + タイムスタンプ + リアクション。Web フロントの投稿フォームから入力・送信可能。
- 画像添付: Web は署名付き URL などで R2 に直接アップロードし、返却されたパスを API に送信。アップロード時に最大 2MB、かつ縦横最大 1920x1920px にリサイズして保存。
- アバター: 一般ユーザーは固定のプレースホルダを表示。管理者のみ Pages 静的領域のアイコン画像を表示し、attachments とは別扱い。

## D1 データモデル

### chats

| カラム      | 型         | 備考                                                                    |
| ----------- | ---------- | ----------------------------------------------------------------------- |
| id          | text PK    | ランダム非衝突 ID (UUID/ULID)                                           |
| body        | text       | 本文 (最大 280 文字)                                                    |
| nickname    | text       | 投稿者名 (匿名許容)                                                     |
| attachments | json       | `[ { type: "image", path: "/r2/chat/<id>/<file>.jpg" } ]` など。R2 パス |
| source_kind | text       | 'web' \| 'slack'                                                        |
| slack       | json       | Slack 経由のみ `{ user_id, event_id }` を保存                           |
| is_deleted  | bool       | モデレーション用フラグ                                                  |
| created_at  | int (unix) | 投稿時刻                                                                |
| updated_at  | int (unix) | 更新時刻                                                                |
| deleted_at  | int (unix) | 論理削除時刻 (is_deleted=true 時のみ)                                   |

### chat_searches

チャット本文の全文検索用 token を保持します。

| カラム     | 型         | 備考                         |
| ---------- | ---------- | ---------------------------- |
| chat_id    | text FK    | chats.id                     |
| body_fts   | text       | 本文の token 化結果 (D1 FTS) |
| created_at | int (unix) | インデックス生成時刻         |
| updated_at | int (unix) | 最終更新時刻                 |

## Slack 連携仕様

- 投稿経路: Slash コマンド `/chat` または Webhook。リクエストボディには Slack サーバー署名 (`X-Slack-Signature`/`X-Slack-Request-Timestamp`) を含める。API 側で検証。
- 投稿後のレスポンス: Slack には JSON で即時返信し、本文・ニックネームを `chats` に保存。Slack 由来のアバターは保存せず、管理者のみ静的アイコンを表示する。
- 権限制御: Slack 側のユーザーは全員投稿可。モデレーションは管理 API で `is_deleted=true` に設定しフィードから非表示。
- 重複防止: `chats.slack.event_id` に UNIQUE 制約（`source_kind='slack'` の部分インデックス）を設定し、再送は 409 で弾く。

## API インターフェース

共通レスポンス: 成功 `{ data: ... }`, エラー `{ error: { code, message } }`。`Request-Id` を付与。

| メソッド/パス                  | Query/Body                                                                  | Response `data`                                  | 備考                                                    |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| GET `/api/chat`                | Query: `offset?` (default 0), `limit?` (default 20, max 50)                 | `{ items: ChatSummary[], offset, limit, total }` | `is_deleted=false` のみ。Edge cache 30s                 |
| POST `/api/chat`               | Body `{ body: string, nickname?: string, attachments?: AttachmentInput[] }` | `{ chat: ChatDetail }`                           | Web投稿用。本文 280 文字以内、添付は画像のみ。R2 に保存 |
| POST `/api/chat/slack`         | Slack 署名付きリクエスト (Slash コマンド/イベントの payload)                | `{ ok: true, chat?: ChatDetail }`                | Slack 用エンドポイント。署名検証必須                    |
| DELETE `/api/chat/:id` (admin) | -                                                                           | `{ deleted: true }`                              | Cloudflare Access/Bearer。`is_deleted=true` にする      |
| GET `/api/chat/:id` (optional) | -                                                                           | `{ chat: ChatDetail }`                           | 単体取得                                                |

レスポンス例:

- GET `/api/chat`

```json
{
  "data": {
    "items": [
      {
        "id": "chat_01HXYZ",
        "body": "今日の作業メモ",
        "nickname": "sakura",
        "attachments": [
          { "type": "image", "path": "/r2/chat/chat_01HXYZ/image-1.jpg" }
        ],
        "sourceKind": "web",
        "reaction": { "👍": 2, "🎉": 1 },
        "createdAt": 1735700000,
        "updatedAt": 1735700000
      }
    ],
    "offset": 0,
    "limit": 20,
    "total": 120
  }
}
```

- POST `/api/chat`

```json
{
  "data": {
    "chat": {
      "id": "chat_01HXYZ",
      "body": "新しいリリースを出しました",
      "nickname": "bot",
      "attachments": [
        { "type": "image", "path": "/r2/chat/chat_01HXYZ/image-1.jpg" }
      ],
      "sourceKind": "web",
      "reaction": {},
      "createdAt": 1735700100,
      "updatedAt": 1735700100
    }
  }
}
```

- POST `/api/chat/slack` (Slash コマンド)

```json
{
  "data": {
    "ok": true,
    "chat": {
      "id": "chat_01HXYZ",
      "body": "Slack から投稿",
      "nickname": "slack:user123",
      "attachments": [],
      "sourceKind": "slack",
      "reaction": {},
      "createdAt": 1735700200,
      "updatedAt": 1735700200
    }
  }
}
```

## API クライアント契約

- TypeScript 例:

  ```ts
  type Attachment = { type: "image"; path: string };
  type AttachmentInput = { type: "image"; path: string }; // path は R2 の相対パス(`/r2/chat/...`)
  type ChatSummary = {
    id: string;
    body: string;
    nickname: string;
    attachments?: Attachment[];
    sourceKind: "web" | "slack";
    reaction?: Record<string, number>;
    createdAt: number;
    updatedAt: number;
  };
  type ChatDetail = ChatSummary;
  ```

- リアクションは Reaction API (`POST /api/reactions/chat/:id`) を利用。`targetKind="chat"` として集計。

## Slack 署名検証

- ヘッダー `X-Slack-Signature` と `X-Slack-Request-Timestamp` を受け取り、Slack Signing Secret で署名を検証。リプレイ攻撃防止のため 5 分超のリクエストは拒否。

## バリデーション / モデレーション

- 本文 280 文字以内、空文字不可。
- 添付画像: 3 枚まで、各 2MB 以内。アップロード時に最大 1920x1920px へリサイズ。拡張子は jpeg/png/webp。パスに `https://` は含めず R2 の相対パスを送る。
- スパム対策: Cloudflare Turnstile (Web)、IP レートリミット (KV)。
- 削除: 管理 API で `is_deleted=true`。フロントの一覧では非表示。

## インデックス / 検索

- `chat_searches` に token 化した本文を保持し、Search 仕様の Lexical モードで `kind=chat` として検索対象にする。
- 生成/更新は GitHub Actions または Web 投稿時に同期で実行。

## キャッシュ

- 一覧は KV にページ単位で短期キャッシュ。投稿/削除時に該当ページをパージ。

## デプロイ / 同期

- GitHub Actions で lint/test → `wrangler pages deploy`。Slack Secret/署名キーは `wrangler secret`。
- 本文はプレーンテキストで保存。Markdown 変換は行わず、添付画像は R2 に事前アップロードしたパスを保存。
