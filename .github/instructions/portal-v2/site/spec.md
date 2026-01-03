# Site Specification

`portal.sakurada.io` および `kuratasatoc.dev` (オリジン: `portal.sakurada.io`) にホストされる Web サイトの仕様を定義します。Cloudflare と GitHub Actions を前提に、API クライアント/サーバーのインターフェースを明記します。

## メタ指針

- 本書はエントリーポイント。各機能の詳細仕様は以下に記載し、内容が衝突する場合は各機能ディレクトリの `spec.md`（Article/Category/Reaction/Chat/NowPlaying/Payment/Search）を優先する。
- 実装時は丁寧に計画・実装すること（時間優先より正確さ優先）。
- コードコメントは日本語で記載する。
- 実装言語は Go を推奨。ただし利用ライブラリ/SDK が乏しい場合は TypeScript でも可。

## アーキテクチャ

- フレームワーク/SSR: Hono + Preact。Cloudflare Pages Functions で SSR/API を実装し、静的アセットは Pages に配置。必要に応じて Workers に切り出し。
- ストレージ: D1 (articles/comments/categories/search indexes/chat/nowplaying/payments/users), KV (キャッシュ・レート制御・リアクション集計), R2 (画像/添付), Queues/Cron (NowPlaying 収集や webhook 再試行)。
- ルーティング: `_routes.json` / Hono で静的配信と SSR/API を振り分け。記事/チャット/NowPlaying/決済 API は Functions 配下に集約。
- 認証/認可: 基本は匿名。管理操作は Cloudflare Access JWT または Bearer。ペイウォールは Payment 仕様に従い `POST /api/articles/:slug/access` で判定。
- キャッシュ: Cloudflare CDN で静的/一覧 API を短期キャッシュ、KV にもホットデータを保存。個別ページは 60 秒程度の Edge キャッシュ。
- インフラ構築: repository-root/portal-v2/terraform に IaC 定義。GitHub Actions でビルド・テスト・デプロイを自動化。

## 機能別仕様の参照

API 定義とデータモデルは各機能の仕様書を参照してください。

| Domain      | Spec パス                                                 | 備考                       |
| ----------- | --------------------------------------------------------- | -------------------------- |
| Article     | `blogs/.github/instructions/portal-v2/article/spec.md`    | 記事・コメント・価格情報   |
| Category    | `blogs/.github/instructions/portal-v2/category/spec.md`   | カテゴリ管理               |
| Reaction    | `blogs/.github/instructions/portal-v2/reaction/spec.md`   | リアクションと集計         |
| Chat        | `blogs/.github/instructions/portal-v2/chat/spec.md`       | 短文投稿・Slack 連携       |
| NowPlaying  | `blogs/.github/instructions/portal-v2/nowplaying/spec.md` | 再生履歴収集/表示          |
| Payment     | `blogs/.github/instructions/portal-v2/payment/spec.md`    | 買い切り課金・アクセス判定 |
| Search      | `blogs/.github/instructions/portal-v2/search/spec.md`     | 検索基盤・API              |
| Site (this) | `blogs/.github/instructions/portal-v2/site/spec.md`       | 全体要件・UI/非機能        |

## ページ / コンテンツ要件

### Navigation Header

- ロゴ: 左上に配置。クリックで Home へ遷移。
- タブバー: 中央上部に `Home`, `About`, `Blog`, `Chat`, `NowPlaying`, `Contact`, `Search` (アイコンのみ)。
- レスポンシブ: モバイルではハンバーガーメニュー。

### Body

- タブバー直下にメインコンテンツエリア。画面サイズに応じて最適化。ページごとに異なるレイアウト。

### Home Page

- 注目のブログ記事: `isFeatured` 記事を日付降順にリスト表示。
- iframe 埋め込み: YouTube、Spotify、X (Twitter) フィード等。
- ミニウィジェット: Chat/NowPlaying の最新 3 件を表示し、詳細ページへリンク。

### About Page

- 自己紹介セクション: 簡単なプロフィール文章と画像。
- 経歴セクション: 職歴やプロジェクトのタイムライン。
- スキルセットセクション: 使用技術やツールのリスト。
- 趣味・興味セクション: 趣味や関心事の紹介。

### Blog Page List

- 一覧表示: 投稿日時の降順。タイトル、サムネイル、抜粋文、投稿日を表示。
- ページネーション: 20 記事/ページ (クエリで変更可)。
- カテゴリーフィルター: カテゴリー別に絞り込み。
- リアクション: 絵文字トグル (👍, ❤️, 🚀, 🎉, 🙏, 😂)。詳細と同期。
- コメント数: 各記事のコメント数表示。
- 有料記事: `pricing` に課金通貨がある場合、タイトル左端に鍵アイコン。

#### Blog Page Detail

- Markdown 入稿/表示: シンタックスハイライト、リンク自動検出、画像埋め込み等に対応。
- 要素: タイトル、投稿日、コンテンツ、カテゴリー、コメントセクション。
- 関連記事: 同一カテゴリー内から最大 5 件表示。
- SNS シェア: X, Facebook, Instagram, LinkedIn。
- コメント投稿: 会員登録不要。ニックネーム + 本文入力欄。オーナーは API で削除可能。
- リアクション: 絵文字トグル (一覧と同期)。
- 有料記事: `pricing` に課金通貨があり `permission.read=false` の場合リード文のみ表示し、購入導線を表示。

#### Paid Content Handling

- アクセス制御: `pricing` に課金通貨がある場合は Payment 仕様に従い `POST /api/articles/:slug/access` で判定し、購入済みのみ本文を解放。
- 購入フロー: Stripe Checkout。決済手段はクレカ/Apple Pay/Google Pay/PayPay。`success_url` と Webhook の両経路で `article_accesses` を upsert（詳細は Payment 仕様）。
- 購入後アクセス: メールリンクの JWT（短命）を署名検証した上で D1 `article_accesses` と突合して即時閲覧を補助。静的 URL 直アクセスは禁止。
- 購入履歴: 「メール + 記事 ID」を `article_accesses` に保存。
- 将来拡張: Stripe Billing でサブスク対応予定（判定ロジックは Payment 仕様の将来拡張方針を参照）。

### Chat Page

- Blog の簡易版 (chat)。短文投稿。詳細ページや Websocket 不要。
- 一覧: 投稿日時降順。投稿者ニックネーム、アイコン、本文、投稿日。
- ページネーション: 20 件/ページ (無限スクロール対応)。
- リアクション: 絵文字トグル (一覧と同期)。
- デザイン: Slack 風バブル。タイムスタンプ表示。
- 投稿フォーム: ニックネーム、画像添付（R2 保存・2MB/最大 1920x1920 リサイズ）、本文。送信ボタン or `⌘+Enter`。
- バリデーション: 必須チェック、本文 280 文字以内。
- Slack 連携: Slack からのメッセージを API 経由で自動投稿。

### NowPlaying Page

- 一覧: YouTube Music の再生履歴を再生時刻降順で表示 (タイトル、アーティスト、アルバムアート、再生日時)。
- ページネーション: 20 曲/ページ (無限スクロール対応)。
- リアクション: 絵文字トグル (一覧と同期)。

### Contact Page

- フォーム: 氏名/ニックネーム、メールアドレス、件名、本文。
- バリデーション: 必須チェック、メール形式検証。
- サンクスページ: 送信完了後に表示。
- スパム対策: Turnstile/recaptcha、レートリミット。

### Search Icon / Search

- クリックでモーダル表示。
- 検索バー: キーワード入力。
- 対象: Blog のタイトル/本文/カテゴリー + Chat 本文。
- 結果: タイトル、サムネイル、抜粋文、投稿日。10 件/ページ。
- リアクション: 表示のみ (同期)。

### Footer

- コピーライト表記、プライバシーポリシー、利用規約リンク。
- ソーシャルメディアアイコンとリンク。

## Styling

- カラースキーム: ライト/ダーク切替 (デフォルトはライト)。
- カラー: 落ち着いたトーン。ライトは白基調、ダークは濃い GitHub テイスト。
- レイアウト: 枠線が少なくシンプルで直感的。
- フォント: 可読性の高い標準 Web フォント。
- **Tailwind CSS の使用禁止**。シンプルな CSS を手書き (2025-12 時点の最新記法)。

## Accessibility

- WCAG 2.1 AA 準拠。コントラストとキーボード操作を確認。

## Internationalization

- 日本語 / English / 他言語に対応。ロケールはクエリ/ヘッダで判定し、文言は辞書管理。

## SEO

- 適切なメタタグ、構造化データ、サイトマップ、robots.txt。
- 内部リンク最適化、高速読み込み、キーワード最適化。

## デプロイ / GitHub Actions

- `content-build` (Blog 仕様) → Markdown 前処理。
- `build-client` (Vite, Islands/Widgets), `build-server` (tsup/esbuild)。
- `test` (lint/type/e2e) 後、`wrangler pages deploy` または `wrangler deploy`。
- Secrets は `wrangler secret` で注入 (Stripe/メール/DB URL 等)。
- `_routes.json` やキャッシュ設定はデプロイ前に生成。

## パフォーマンス / セキュリティ / 監視

- Cache: Edge キャッシュと KV を併用。`ETag` と `Cache-Control` を設定。
- レートリミット: IP ベースで API を保護。CORS は自ドメインのみ。
- セキュリティヘッダ: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` 等を Hono ミドルウェアで付与。
- 監視: Workers Analytics Engine にリクエスト数/エラー率/レイテンシを送信。ビルド失敗や Webhook 失敗は Slack/Webhook で通知。
