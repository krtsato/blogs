# portal-v2 開発メモ

- ローカル実行: `npm install` → `npm run dev` (wrangler dev)
- 型チェック: `npm run check`
- 価格同期 (DRY_RUN): `npm run sync:prices`（`scripts/sync-stripe-pricing.js` 内の PRICES を編集）
- 価格同期 (sandbox DRY_RUN): `npm run sync:prices:sandbox`
- デプロイ CI: `.github/workflows/portal-v2-cd.yaml` を手動実行（wrangler dry-run）
- 価格同期 CI: `.github/workflows/portal-v2-stripe-pricing.yaml` を手動実行（DRY_RUNで live/sandbox 両方を確認）
- Terraform 雛形: `terraform/main.tf`（R2/KV/D1/Vectorize/Pages バインディング付き。`terraform.tfvars.example` をコピーして値を設定）

主なバインディング（wrangler/環境変数）

- D1: `DB`
- R2: `R2_ATTACHMENTS`
- KV: `REACTIONS_KV`, `NOWPLAYING_KV`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Stripe sandbox: `STRIPE_TEST_SECRET_KEY` または `STRIPE_SECRET_KEY_SANDBOX`（`STRIPE_MODE=sandbox` で同期）
- Mail: `RESEND_API_KEY`
- Slack: `SLACK_SIGNING_SECRET`
- Vectorize: `VECTORIZE_INDEX`, `VECTORIZE_API_TOKEN`
- YouTube: `YOUTUBE_API_KEY`, `YOUTUBE_PLAYLIST_ID`

Cron（wrangler の schedule で実行）

- NowPlaying TTL 削除 + YouTube 取得: `scheduled` ハンドラで実行
- Reaction snapshots 再計算: `scheduled` ハンドラで実行

## TODO / 残課題

- Webクライアント実装計画
  - UI: Articles/Chat/NowPlaying/Reaction の一覧・詳細・投稿フォームを実装（Slack風チャットUI、画像添付プレビュー）。
  - API接続: `/api/*` に対する fetch ラッパーと型付け（記事/課金/チャット/リアクション/検索/NowPlaying）。
  - 画像アップロード: Chatの添付を multipart/form-data でAPIへ送るフォームとプレビュー、アップロード前の圧縮・リサイズ（品質90%/max1920px）のクライアント実装。
  - 課金フロー: 記事詳細で有料判定→Checkout開始→success/webhook後の即時閲覧処理に対応。
  - 検索UI: lexical/semantic 切替の検索フォームと結果表示、記事/チャットの種別タブ。
  - モデレーション: 管理者だけの削除/非表示操作（記事・コメント・チャット・リアクション）。
  - レートリミット対応: Turnstileウィジェット組み込み（チャット投稿）、429時のリトライUI。
- ローカルデバッグ方法（Webフロント想定）
  - `npm install` → `npm run dev` で wrangler dev を起動（Pages Functions をローカルに立てる）。
  - フロントは同一オリジンで動かし、`.env.local` などで API ベースURL を `http://127.0.0.1:8787` に設定。
  - KV/D1 は wrangler のローカルエミュレータを利用。Stripe/Slack/YouTube など外部はテストキーに切替え、必要に応じてモックレスポンスを用意。
