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

- 特になし（Terraform バインディングまで設定済み。必要に応じて tfvars を実環境値に差し替えて apply）
