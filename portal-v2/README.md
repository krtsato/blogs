# portal-v2 開発メモ

- ローカル実行: `npm install` → `npm run dev` (wrangler dev)
- 型チェック: `npm run check`
- 価格同期 (DRY_RUN): `npm run sync:prices`（`payment/prices.yaml` を編集）
- デプロイ CI: `.github/workflows/portal-v2-deploy.yaml` を手動実行（wrangler dry-run）
- Terraform 雛形: `terraform/main.tf`（R2/KV の作成例。アカウント ID やトークンを適宜設定）

主なバインディング（wrangler/環境変数）

- D1: `DB`
- R2: `R2_ATTACHMENTS`
- KV: `REACTIONS_KV`, `NOWPLAYING_KV`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Mail: `RESEND_API_KEY`
- Slack: `SLACK_SIGNING_SECRET`
- Vectorize: `VECTORIZE_INDEX`, `VECTORIZE_API_TOKEN`
- YouTube: `YOUTUBE_API_KEY`, `YOUTUBE_PLAYLIST_ID`

Cron（wrangler の schedule で実行）

- NowPlaying TTL 削除 + YouTube 取得: `scheduled` ハンドラで実行
- Reaction snapshots 再計算: `scheduled` ハンドラで実行

## TODO / 残課題

- Payment: 本番用価格定義を作成し、`DRY_RUN=false` で sync 実行するフローの追加
- Chat: 画像リサイズ/圧縮パイプライン（別ワーカー or クライアント前処理）、Turnstile/レートリミット
- Reaction: snapshot バッチの対象期間/頻度の調整、異常検知/監視を追加
- Search: semantic/lexical ヒットのスコアマージ、Vectorize 障害時のフォールバック詳細化
- NowPlaying: nextPageToken/ETag 管理の運用確認、二重取得防止のさらなる強化、KV キャッシュ無効化戦略のチューニング
- Terraform: D1/Vectorize/Workers Pages のバインディング追加、tfvars 整備
