# Hono 移行計画書

## 背景・前提

- 現状: Cloudflare Workers、Remix 2、Vite、Markdown 記事を GitHub に保存。
- 選定条件: 信頼性と継続性、独自仕様が少なくシンプル、Cloudflare 親和性、Remix 3 は安定まで不採用。
- 追加要件: 有料記事（Stripe 決済）、ライト投稿機能（chat）、NowPlaying 機能（YouTube Music 履歴表示）、リアクション機能（ブログ記事・ライト投稿・NowPlaying 機能に対して絵文字付与）
- 方針: SSR + API + 静的配信を Workers 上で完結。

## 決定事項サマリ

| 項目           | 採用                                                | 理由                                     |
| -------------- | --------------------------------------------------- | ---------------------------------------- |
| フレームワーク | Hono + Preact                                       | Workers 親和性と軽量 SSR/Hydration       |
| デプロイ先     | Cloudflare Workers/Pages Functions                  | 既存基盤を継続、低レイテンシ             |
| コンテンツ処理 | Markdown をビルド時前処理                           | Workers での実行時変換を回避             |
| ストレージ     | D1 + KV + (必要に応じて R2)                         | RDB 構造化 + 高速カウンタ + オブジェクト |
| 非同期         | Queues + Cron Triggers                              | NowPlaying 収集や再試行を分離            |
| 認証           | サインド Cookie/JWT（必要に応じ Cloudflare Access） | 軽量で Workers に適合                    |

## 全体アーキテクチャ

| レイヤ               | 技術選定                      | 補足                                                  |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| ルーティング/SSR/API | Hono                          | `app.get/post` で統一、ミドルウェアで認証・レート制御 |
| ビュー               | Preact                        | 小さいバンドル、React 互換で再利用性高                |
| クライアントビルド   | Vite                          | Island/Widget 用エントリを分割                        |
| コンテンツ           | Markdown (GitHub)             | サブモジュール/`sparse-checkout` で同期               |
| 配信                 | Pages 静的配信 + Hono SSR/API | `_routes.json` や `_redirects` で振り分け             |
| ストレージ           | D1 / KV / R2 / Queues         | 用途別に役割分担（次章参照）                          |

## ストレージ設計

| リソース    | 主用途                                                            | 代表データ/キー例                                                                   |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D1          | ユーザー、購読、記事アクセス、chat、リアクションログ、NowPlaying | `users`, `subscriptions`, `article_access`, `chats`, `reactions`, `tracks`, `plays` |
| KV          | リアクションカウンタ、レートリミット、軽量キャッシュ              | `reactions:{target}` → `{emoji: count}`, `ratelimit:{ip}`, `cache:articles:{slug}`     |
| R2          | 画像・添付・バックアップ                                          | `/assets/{slug}/image.jpg`                                                          |
| Queues/Cron | NowPlaying 収集、Webhook 再試行                                   | `nowplaying-fetch`, `webhook-retry`                                                 |

## Markdown 前処理パイプライン

- 目的: Workers でのランタイム変換を避け、HTML/メタをビルド成果物として持つ。
- プラグイン例: `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-rehype`, `rehype-slug`, `rehype-autolink-headings`, `rehype-pretty-code`(Shiki) または `rehype-highlight`。
- 生成物パターン:
  - `public/content/index.json`（メタ一覧）と `public/content/articles/<slug>.json`（`{ html, meta }`）。
  - もしくは `content/build/<slug>.js` で `export const html/meta` を動的 import。
- 配置: Pages の静的配信に載せるか、KV/R2 にアップロード（更新頻度が低いならバンドル同梱が単純）。

## ビルド＆デプロイ工程

| ステップ              | コマンド/処理                                                                            | 成果物/ポイント                           |
| --------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1. コンテンツ同期     | `git submodule update --init --recursive` または `git sparse-checkout set content/articles` | Markdown を取得                           |
| 2. Markdown 前処理    | `npm run preprocess:content`（Node）                                                     | JSON/JS 生成、Shiki でハイライト          |
| 3. クライアントビルド | `npm run build:client`（Vite）                                                           | `public/assets` に Island/Widget バンドル |
| 4. サーバビルド       | `npm run build:server`（tsup/esbuild）                                                   | Hono を Workers 形式にバンドル            |
| 5. デプロイ           | Pages Functions: `wrangler pages deploy dist` / Workers: `wrangler deploy`               | Route を `example.com/*` に設定           |

## ルーティングと SSR

| パス               | 役割                  | 実装ポイント                                                                                        |
| ------------------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /`            | トップ                | `index.json` で記事一覧を SSR。chat/NowPlaying ウィジェットは SSR スケルトン＋クライアントフェッチ |
| `GET /articles/:slug` | 記事表示              | ビルド成果物 `{html, meta}` を挿入。権限により有料部分をマスク                                      |
| `GET /chat`        | ライト投稿一覧        | SSR 一覧＋投稿フォーム/リアクションを Hydration                                                     |
| 静的配信           | `/assets`, `/content` | `serveStatic` または Pages 静的配信                                                                 |

## API 設計

| 分類         | エンドポイント                               | 役割                                    | ストレージ                             |
| ------------ | -------------------------------------------- | --------------------------------------- | -------------------------------------- |
| 決済         | `POST /api/payments/create-checkout-session` | Stripe Checkout セッション生成          | D1 (`subscriptions`, `article_access`) |
| 決済         | `POST /api/payments/webhook`                 | Stripe Webhook 受信・署名検証・状態更新 | D1、Queues(再試行)                     |
| 記事アクセス | `GET /api/articles/:slug/access`                | アクセス権確認（SSR/CSR 共用）          | D1                                     |
| chat        | `GET /api/chat`                              | 一覧取得（ページング）                  | D1                                     |
| chat        | `POST /api/chat`                             | 投稿（認証必須）                        | D1                                     |
| リアクション | `POST /api/chat/:id/reactions`               | リアクション追加                        | KV カウンタ + D1 ログ                  |
| NowPlaying   | `GET /api/nowplaying`                        | 最新 1 件取得                           | D1                                     |
| NowPlaying   | `GET /api/nowplaying/recent`                 | 直近一覧取得                            | D1                                     |
| NowPlaying   | `POST /api/nowplaying/:playId/reactions`     | リアクション追加                        | KV + D1                                |

## 認証・認可

| 項目       | 選択肢                             | 運用ポイント                 |
| ---------- | ---------------------------------- | ---------------------------- |
| 認証方式   | サインド Cookie + KV セッション    | 軽量、Workers に適合         |
| 代替       | Cloudflare Access JWT              | 管理者向けに有効             |
| 権限判定   | `article_access` / `subscriptions` | SSR 時に本文マスクを出し分け |
| レート制御 | KV トークンバケット                | API 濫用防止                 |

## 機能別の設計要点

| 機能                      | 主要設計                                                              | UI/SSR 方針                                         |
| ------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| Markdown ブログ           | ビルド前処理で HTML/メタ生成、`index.json` と `<slug>.json/js` を読む | SSR で本文描画、必要箇所のみ Hydration              |
| 有料記事 + Stripe         | Checkout セッション + Webhook、`article_access` 更新                  | SSR で権限判定して本文をマスク/解放                 |
| chat + リアクション       | D1 に投稿、KV でカウンタ、D1 にログ                                   | SSR 一覧、フォーム/リアクションを Island 化         |
| NowPlaying + リアクション | Cron/Queue で収集 → D1 保存、リアクションは KV + D1                   | ウィジェットを SSR スケルトン＋クライアントフェッチ |

## マイグレーションと段階導入

| フェーズ | 目的                                         | 完了条件                                    |
| -------- | -------------------------------------------- | ------------------------------------------- |
| 1        | Markdown 同期と静的ブログ SSR + リアクション | 既存記事が新ルートで閲覧可                  |
| 2        | chat + リアクション                          | 投稿/リアクション API が稼働し UI 反映      |
| 3        | Stripe 決済・有料記事                        | Webhook 安定、権限判定で本文が切替          |
| 4        | NowPlaying                                   | Cron/Queue でデータ蓄積、Widget が表示/更新 |
| 5        | 最適化                                       | キャッシュ・レートリミット・監視が有効      |

## セキュリティ・運用

- Stripe Webhook は専用ルートに分離し、冪等性キーで多重処理を防ぐ。
- CORS は必要 Origin のみに限定。
- Secrets/Keys は `wrangler secret put` で管理し、コードへ直書きしない。
- 監視: Workers Analytics Engine でエラー率/レイテンシ、Webhook 失敗回数、Queue バックログを定期確認。
- バックアップ: D1 エクスポート、R2 スナップショットを定期実行。

## 用語解説

- Hono: Fetch API 互換の軽量 Web フレームワーク。`app.get('/path', handler)` でルートを定義。
- Cloudflare Workers/Pages Functions: Cloudflare 上のサーバレス実行環境。低レイテンシで従量課金。
- D1: SQLite 互換のマネージド DB。SQL でテーブル操作。
- KV: キーと値の単純ストア。高速 read/write が必要なカウンタやキャッシュに向く。
- R2: オブジェクトストレージ。画像や大きなファイル保存に使う。
- Queues/Cron Triggers: バックグラウンド処理や定期実行を行う仕組み。
- SSR（Server-Side Rendering）: サーバ側で HTML を生成して返す方式。
- Hydration: SSR 済みの HTML にクライアント JS を紐づけてインタラクティブ化すること。
- Preact: React とほぼ互換の軽量ライブラリ。バンドルが小さい。
- Vite: 高速なビルドツール。クライアントバンドル生成に使用。
- Wrangler: Cloudflare 向け CLI。デプロイやシークレット設定に使う。
- remark/rehype: Markdown を HTML/JSX に変換するプラグイン体系。
- Stripe: 決済サービス。Checkout/Webhook を通じて課金やサブスク管理を行う。
