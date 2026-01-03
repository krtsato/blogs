# Article Specification

ブログ記事 (Markdown 入稿) の取得・表示・コメント投稿に関する仕様を定義します。Cloudflare Pages/Workers と GitHub Actions で完結し、API クライアント/サーバーのインターフェースを明記します。

## ゴールと範囲

- Markdown 記事をビルド時に前処理し、軽量に SSR/配信する。
- カテゴリー/検索/絞り込み付きの一覧と詳細表示を提供する。
- コメント投稿・表示を提供する（認証不要、スパム対策あり）。
- 有料記事のペイウォール判定・購入導線は Payment 仕様に従う。

## アーキテクチャ

- 配信: Cloudflare Pages の静的アセット + Pages Functions (Hono) による SSR/API。
- 前処理: GitHub Actions で Markdown → HTML/メタ (`public/content/index.json`, `public/content/articles/<slug>.json`) を生成し Pages の静的領域に配置。本文は D1 に保存しない。
- ストレージ: D1 (コメント・記事メタ・インデックス), KV (軽量キャッシュ/レートリミット), R2 (画像/添付, 必要時)。本文は静的ファイル (Pages/KV/R2) で配信し、D1 にはメタ + パスのみ保持。
- リアクション: Reaction 仕様に従い KV + D1 で管理。
- 有料判定: Payment 仕様の `article_access`/トークン検証を参照。

## D1 データモデル

### articles

| column           | type        | note                                                                  |
| ---------------- | ----------- | --------------------------------------------------------------------- |
| id               | text PK     | ランダム非衝突ID (UUID/ULID)。外部APIは slug を受け取り内部で id 解決 |
| slug             | text UNIQUE | 人間可読 URL（外部公開用キー。APIは slug で受け取り内部で id 解決）   |
| title            | text        |                                                                       |
| excerpt          | text        | テキスト要約                                                          |
| image_url        | json        | `{ locale: { cover?, og?, thumb? } }`、スキーム/ドメインなしパス      |
| is_featured      | bool        | トップページに掲載するためのフラグ                                    |
| pricing          | json        | `{ currency: { amount, unit } }`                                      |
| status           | text        | 'published' / 'draft'                                                 |
| created_at       | int (unix)  |                                                                       |
| published_at     | int (unix)  |                                                                       |
| updated_at       | int (unix)  |                                                                       |
| content_path     | text        | Pages 静的 JSON へのパス                                              |
| reading_time_sec | int         |                                                                       |

画像の使い分け: `cover` は詳細ページカバー（旧 hero）、`thumb` は一覧カード/関連記事用、`og` は SNS 共有用 (1.91:1 推奨)。

### article_categories

詳細は Category 仕様を参照。

| column      | type       | note |
| ----------- | ---------- | ---- |
| article_id  | text FK    |      |
| category_id | integer FK |      |

### comments

| column      | type                | note                                                                             |
| ----------- | ------------------- | -------------------------------------------------------------------------------- |
| id          | text PK             |                                                                                  |
| article_id  | text FK             |                                                                                  |
| nickname    | text                |                                                                                  |
| body        | text                |                                                                                  |
| email_hash  | text nullable       |                                                                                  |
| created_at  | int (unix)          |                                                                                  |
| deleted_at  | int (unix) nullable | ソフト削除時のタイムスタンプ（監査用）                                           |
| fingerprint | text                | IP+UA ハッシュ                                                                   |
| is_deleted  | bool                | ソフト削除フラグ（通常 false）。`deleted_at` と併用し、一覧/API 返却から除外する |

ソフト削除方針: `is_deleted=true` のレコードはクエリ/レスポンスから除外しつつ、`deleted_at` にタイムスタンプを残して監査・復元の証跡に用いる。

### article_searches

検索用テーブル

| column     | type       | note   |
| ---------- | ---------- | ------ |
| article_id | text FK    |        |
| title      | text       |        |
| excerpt    | text       |        |
| tokens     | text       | 検索用 |
| created_at | int (unix) |        |
| updated_at | int (unix) |        |

### 有料アクセス

Payment 仕様との連携について記載します。

- 有料記事のアクセス権は Payment 仕様の `article_access` テーブルで管理する（キー: `article_id` + `email/token`。API では slug を受け取り内部で id に解決）。検索インデックスとは分離し、本文やメタの閲覧可否判定にのみ使用する。

※検索仕様の詳細は `search/spec.md` を参照。

## API インターフェース

Hono / Pages Functions で提供する API です。

共通: `Content-Type: application/json`。成功 `{ data: ... }` / エラー `{ error: { code, message } }`。日時はすべて unix time (秒)。

| Method/Path                               | Query/Body                                                                                                                                    | Response `data`                                     | Notes                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| GET `/api/articles`                       | Query: `offset` (default 0), `limit` (<=50, default 20), `category`, `search`, `isFeatured`, `includeDraft` (admin), `includePaidMeta` (bool) | `{ items: ArticleSummary[], offset, limit, total }` | CDN cache 300s (searchは `no-store`)                                |
| GET `/api/articles/:slug`                 | Query: `previewToken` (admin), `includeComments` (bool)                                                                                       | `ArticleDetail`                                     | 課金記事は `paywall` 非 null。本文返却には `permission.read=true`。 |
| GET `/api/articles/:slug/comments`        | Query: `offset` (default 0), `limit` (<=50, default 20)                                                                                       | `{ items: Comment[], offset, limit, total }`        |                                                                     |
| POST `/api/articles/:slug/comments`       | Body: `{ nickname (<=40), body (<=1000), email?, turnstileToken? }`                                                                           | `Comment`                                           | 必須/NGワード/Turnstile、IP レートリミット 5 req/min                |
| DELETE `/api/articles/:slug/comments/:id` | Header: 認可 (Access JWT/Bearer)                                                                                                              | `Comment` (ソフト削除後)                            | `is_deleted=true`, `deleted_at` 設定                                |
| POST `/api/reactions/articles/:slug`      | Body: Reaction 仕様                                                                                                                           | Reaction 仕様                                       | 記事スラッグで対象識別                                              |
| GET `/api/reactions/articles/:slug`       | Query: `fingerprint?`                                                                                                                         | Reaction 仕様                                       | 30s キャッシュ                                                      |

`ArticleSummary` 例:

```json
{
  "slug": "hello-world",
  "title": "Hello World",
  "excerpt": "これは概要テキストです。",
  "imageUrl": { "ja": { "cover": "/images/articles/hello/cover.jpg", "thumb": "/images/articles/hello/thumb.jpg" } },
  "categories": ["cf", "hono"],
  "publishedAt": 1735689600,
  "isFeatured": true,
  "pricing": { "JPY": { "amount": 980, "unit": "¥" } },
  "reaction": { "👍": 3, "❤️": 1 },
  "commentCount": 12
}
```

`ArticleDetail` 例:

```json
{
  "slug": "...",
  "title": "...",
  "excerpt": "...",
  "bodyHtml": "<p>...</p>",
  "imageUrl": { "ja": { "cover": "/images/articles/foo/cover.jpg", "og": "/images/articles/foo/og.jpg" } },
  "categories": ["..."],
  "publishedAt": "...",
  "updatedAt": "...",
  "pricing": { "JPY": { "amount": 980, "unit": "¥" } },
  "paywall": { "required": true, "reason": "payment_required" },
  "permission": { "read": true, "comment": true },
  "readingTimeSec": 480,
  "reaction": { "👍": 10, "❤️": 2 },
  "commentCount": 5
}
```

- `bodyHtml`: Pages 静的領域の `content_path` から取得したサニタイズ済み全文。`permission.read=false` の場合は `null` もしくはリードのみを返す。
- ペイウォール: `pricing` に有料通貨がある場合 `paywall` 非 null。本文返却には `permission.read=true` が必要。
- 認可: `permission` で閲覧/コメント権限を同時返却し、別 API には分割しない。

## API クライアント契約

- TypeScript 例:

  ```ts
  type ImageUrl = Record<string, { cover?: string; og?: string; thumb?: string }>;
  type PricingMap = Record<string, { amount: number; unit: string }>; // e.g., { JPY: { amount: 980, unit: "¥" }, USD: { amount: 6.4, unit: "$" } }
  type Permission = { read: boolean; comment: boolean; [k: string]: boolean };
  type ArticleSummary = { slug: string; title: string; excerpt: string; imageUrl?: ImageUrl; categories: string[]; publishedAt: number; isFeatured: boolean; pricing: PricingMap; reaction?: Record<string, number>; commentCount: number }; // imageUrl values are path-only; client prefixes https:// ; publishedAt is unix time (seconds)
  type ArticleDetail = ArticleSummary & { bodyHtml: string | null; paywall: { required: boolean; reason: string } | null; permission: Permission; readingTimeSec: number; contentPath: string; updatedAt: number }; // createdAt is stored in D1 but not returned by API
  type Comment = { id: string; nickname: string; body: string; createdAt: number; isOwner?: boolean }; // createdAt is unix time (seconds)
  ```

- フロントエンドは `fetch` で上記 JSON を取得し、`paywall.required` が true の場合は Payment 仕様で購入導線を表示。
- SSR 時は `Accept: text/html` でも同一 API を内部呼び出しし、結果を埋め込む。

## コンテンツ前処理と GitHub Actions

- ジョブ `content-build` (push to `content/articles/**` または手動トリガ):
  1. Markdown をチェックアウトし `npm run preprocess:content` 実行。
  2. `public/content/index.json` と `public/content/articles/<slug>.json` を生成し Pages 静的領域へ配置 (本文はこの静的ファイルにのみ保存)。
  3. `npm test -- --filter content` でリンク/メタ検証。
  4. 成果物を Pages 用アーティファクトとして保存し `wrangler pages deploy`。
- 生成物は KV/R2 にも同期可能 (`cache:articles:{slug}`) で、Functions 側でミス時フォールバックに利用。D1 はメタデータと `content_path` のみを保持。

## SSR/フロントエンド要件

- Hono + Preact で SSR → Hydration。記事 HTML はサニタイズ済みを埋め込み、コメント/リアクションは Island 化してクライアントフェッチ。
- ページネーションは 20 件/ページ (クエリで上書き可)。
- SEO: `title`, `meta description`, `og:image` をコンテンツメタから生成。構造化データ (Article) を挿入。
- アクセシビリティ: heading 階層を保持し、コードブロックの言語ラベルを表示。

## キャッシュとパフォーマンス

- Cloudflare CDN で `/api/articles` の一覧を 5 分キャッシュ (検索系は no-store)。
- `/api/articles/:slug` は 60 秒キャッシュ、コメント/リアクション部はキャッシュしない (Edge cache bust: `?t=`)。
- 静的 HTML/JSON には `ETag` を付与し 304 を活用。

## 監視・運用

- ログ: Workers Analytics Engine に API 成功率/レイテンシ、コメント投稿失敗率を送信。
- アラート: GitHub Actions のビルド失敗と Webhook (Stripe) 失敗を通知 (Slack/Webhook)。
- D1 マイグレーションは `wrangler d1 migrations apply` を CI から実行。
