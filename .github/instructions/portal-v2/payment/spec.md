# Payment Specification

ブログ有料記事の決済・アクセス制御の仕様を定義します。Stripe を利用し、Cloudflare Workers/Pages Functions (Hono) と GitHub Actions で完結させます。

## ゴールと範囲

- 記事単位の買い切り課金を提供し、サブスクは将来拡張 (Stripe Billing)。
- ブログ側のアカウント登録なしで購入完結 (メール + 決済情報)。
- 決済成功後に署名付き一時トークンをメールリンクに付与し、D1 `article_accesses` と突合して即時閲覧を補助する。

## アーキテクチャ

- 支払い: Stripe Checkout。支払い手段: クレカ, Apple Pay, Google Pay, PayPay (Stripe 経由)。
- サーバー: Cloudflare Pages Functions/Workers 上の Hono で Checkout セッション生成・アクセス判定・Webhook 受信。
- ストレージ: D1 (`article_prices`, `article_accesses`, `stripe_events`, `users`)。トークンは保存せず JWT を検証のみで使用。
- メール配信: Resend API (Workers から呼び出し)。
- CI/CD: GitHub Actions で価格設定ファイルを Stripe に同期し、デプロイを実行。

## メール配信サービス

Resend を採用する。月 3,000 通まで無料、以降は $20/50k 通などのシンプルな従量課金。Workers から直接呼び出しやすく、MailChannels/SendGrid/Postmark は採用しない前提。

参考: メール配信サービスの課金形態

| サービス     | 無料枠                                                | 料金目安 (公開プラン例)     | 備考                                           |
| ------------ | ----------------------------------------------------- | --------------------------- | ---------------------------------------------- |
| MailChannels | 公式な無料枠なし（Cloudflare 経由の無料枠は廃止傾向） | 要問い合わせ/従量           | Workers から送信可だが無料枠に依存できない     |
| Resend       | 月 3,000 通まで無料                                   | $20/50k 通、$40/100k 通など | シンプルな API。Workers から直接呼び出しやすい |
| SendGrid     | 100 通/日（無料）                                     | $19.95/50k 通〜             | SMTP も可。無料枠は日次上限                    |
| Postmark     | 無料なし（トライアルのみ）                            | $15/10k 通〜                | トランザクションメール特化                     |

※正確な料金は導入時に最新のプランを必ず確認する。

## D1 データモデル

### article_prices

| column          | type        | note                                               |
| --------------- | ----------- | -------------------------------------------------- |
| article_id      | text FK     | API は slug で受け取り内部で id に解決。複合主キー |
| currency        | text        | 通貨コード。複合主キー                             |
| stripe_price_id | text        |                                                    |
| amount          | int/decimal |                                                    |
| unit            | text        | 通貨記号                                           |
| name            | text        |                                                    |
| isActive        | bool        | 有効/無効                                          |
| created_at      | int (unix)  |                                                    |
| updated_at      | int (unix)  |                                                    |

価格マップは API 側で `{ currency: { amount, unit } }` を組み立てて返却。

インデックス:

- PRIMARY KEY (article_id, currency)
- `isActive`（有効価格のみの検索用）

### article_accesses

| column            | type                | note                                   |
| ----------------- | ------------------- | -------------------------------------- |
| id                | uuid PK             |                                        |
| article_id        | text FK             | API は slug を受け取り内部で id に解決 |
| email_hash        | text                |                                        |
| expires_at        | int (unix) nullable | 買い切りは null                        |
| created_at        | int (unix)          |                                        |
| payment_intent_id | text                |                                        |

インデックス:

- `article_id`（記事別アクセス判定）
- `email_hash`（再送/重複判定）
- `payment_intent_id` UNIQUE（Stripe 側イベントとの対応付け）

備考: メールリンク用の JWT は保存せず、その場で署名/exp を検証しつつ `article_accesses` と突合して判定する。

### stripe_events

| column        | type          | note                                   |
| ------------- | ------------- | -------------------------------------- |
| event_id      | text PK       | Stripe イベント ID                     |
| type          | text          |                                        |
| payload       | json          |                                        |
| created_at    | int (unix)    | Stripe イベントの `created` (発生時刻) |
| processed_at  | int (unix)    | 当システムで処理した時刻               |
| status        | text          | 'processed' \| 'failed'                |
| error_message | text nullable |                                        |

インデックス:

- `event_id` PRIMARY
- `status`（失敗イベントの監視用）
- `processed_at`（監査/再処理キュー用）
- 備考:3D Secure や返金イベントの重複排除・監査のため D1 に保持。Stripe ダッシュボードで十分な場合は保存不要だが、障害調査や再処理を考慮して D1 永続を推奨。

### users

将来のサブスクや外部 ID 連携を見据えた汎用ユーザーテーブル。外部サービスの ID を `user` JSON に格納する。

| column     | type          | note                                                                                         |
| ---------- | ------------- | -------------------------------------------------------------------------------------------- |
| id         | uuid PK       | 内部一意 ID                                                                                  |
| email_hash | text UNIQUE   | メールハッシュ。購読判定・重複防止のキー                                                     |
| user       | json          | 外部 ID を保持する map。例: `{ "stripe": { "customer_id": "cus_xxx" } }`（将来 firebase 等） |
| name       | text nullable | 表示名。不要なら null                                                                        |
| created_at | int (unix)    |                                                                                              |
| updated_at | int (unix)    |                                                                                              |

インデックス:

- `email_hash` UNIQUE（重複防止）
- `user->'stripe'->>'customer_id'` UNIQUE（Stripe 連携用）

## API インターフェース

共通レスポンス: 成功 `{ data: ... }`, エラー `{ error: { code, message } }`。

| Method/Path                           | Query/Body                                                         | Response `data`                                       | Notes                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST `/api/payments/checkout-session` | Body `{ articleSlug, email?, currency?, successUrl?, cancelUrl? }` | `{ url, sessionId }`                                  | `article_prices` から通貨別 Price を取得。Rate limit 3 req/min/IP                       |
| POST `/api/payments/success` (内部)   | Body `{ sessionId, slug }`                                         | `{ ok: true }`                                        | success_url からサーバーが呼び出し、Stripe API で検証後に `article_accesses` を upsert  |
| POST `/api/payments/webhook`          | Stripe-Signature header                                            | `{ ok: true }`                                        | `checkout.session.completed` 等で `article_accesses` 作成。冪等性は `event_id`          |
| POST `/api/articles/:slug/access`     | Body `{ email?, token? }`                                          | `{ hasAccess: boolean, reason?, expiresAt?: number }` | token はメールリンク等の JWT。メール入力時は email を送信し D1 で照合。日時は unix time |

## Webhook ハンドリング

- 署名検証: `Stripe-Signature` を検証し、不正なら 400。
- 冪等性: `event_id` を `stripe_events` で確認し、処理済みは 200 で終了。
- 主に処理するイベント:
- `checkout.session.completed`: `article_accesses` を upsert（slug→id 解決、メールハッシュ保存、expires_at 設定）。Resend でアクセス通知メール送信。`users` に email_hash と `user.stripe.customer_id` を upsert。
  - success_url での `POST /api/payments/success` も同様に冪等 upsert（Webhook 遅延対策、本文は返さない）。
- `payment_intent.succeeded`: `checkout.session.completed` の取りこぼし補完。
- `charge.refunded` / `charge.refund.updated`: 対応する `article_accesses` を無効化（ソフト削除または expires_at を過去に設定）。
- `payment_intent.requires_action` (3D Secure): 状態を `stripe_events` に記録し、必要ならユーザー通知（メール送信は省略可）。
- エラーハンドリング: DB 書き込み等が失敗した場合は 500 を返し、Stripe のリトライに任せる。`stripe_events` に `status=failed` と `error_message` を記録。

レスポンス例:

- `POST /api/payments/checkout-session`

```json
{
  "data": { "url": "https://checkout.stripe.com/c/pay_123", "sessionId": "cs_test_123" }
}
```

- `POST /api/articles/:slug/access`

```json
{
  "data": { "hasAccess": true, "expiresAt": 1750000000 } // 買い切りは expiresAt = null
}
```

## API クライアント契約

- フロントフロー
  1. ペイウォール表示時に `POST /api/payments/checkout-session` を呼び出し、返却された `url` にリダイレクト。
  2. Stripe の `success_url` で戻ったら、URL の `session_id`/`slug` を用いて `POST /api/payments/success` を呼び、サーバー側で検証・権限付与を完了させる（本文は返さない）。
  3. 記事表示前に `POST /api/articles/:slug/access` を呼び出し、メール入力または JWT トークンを渡して `hasAccess` を確認し、true の場合に本文を描画する。
- TypeScript 例:

  ```ts
  type AccessResponse = { hasAccess: boolean; reason?: string; expiresAt?: number }; // unix time (seconds)
  type CheckoutResponse = { url: string; sessionId: string };
  ```

## GitHub Actions フロー

- `payment-sync` (手動または `payment/prices.yaml` 変更時):
  1. 価格定義ファイルから Stripe Price/Product を通貨別に作成/更新 (Node スクリプト)。
  2. `article_prices` に通貨別レコードを upsert (wrangler d1 execute)。
  3. 確認用に `payment/prices.lock.json` をコミット (任意)。
  4. **理由**: 価格をコード/リポジトリで管理し、Stripe コンソールでの手作業変更によるドリフトを防ぐため（IaC）。
- `deploy` パイプライン: 本番用 Stripe 秘密鍵を `wrangler secret` で注入し、Functions/Worker をデプロイ。Webhook シークレットも同様。

## セキュリティ・運用

- シークレット: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ACCESS_TOKEN_SECRET`, `RESEND_API_KEY` を `wrangler secret put` 管理。GitHub Actions は OIDC で必要最小限を注入。
- 署名付きトークン: HS256 で署名し、メールリンク用の一時アクセスに使用。買い切りの権利自体は `article_accesses` がソース・オブ・トゥルースで、トークンが失効しても D1 が有効なら再発行すればアクセス可能。`exp` は短め（例: 数時間〜数日）とし、トークンだけに頼らない。
- Webhook 冪等性: `Idempotency-Key` を Stripe 呼び出しで設定、`stripe_events` で処理済み判定（短命な KV TTL でもよいが、監査を兼ねるなら D1 保持が確実）。
- 監視: Workers Analytics Engine で `webhook_failed` をカウントし、3 回連続失敗で Slack 通知。決済成功件数と失敗率も可視化。
- 返金: Stripe Dashboard で返金した場合、Webhook `charge.refunded` で `article_accesses` を失効させる (論理削除)。

## 買い切り記事のアクセス条件・判定フロー

| 判定ステップ           | 入力/格納先                   | 判定内容                                      | 結果と処理                                                         |
| ---------------------- | ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| 1. 記事メタ確認        | D1 `article_prices`           | `isActive` で有料か無料かを判定               | 無料なら本文返却、有料なら次へ                                     |
| 2. アクセス権チェック  | D1 `article_accesses`         | `article_id` + `email_hash` の最新レコード    | 有効なら本文返却、無効/なしなら次へ                                |
| 3. トークン検証 (任意) | 署名付きトークン (JWT, HS256) | `exp` チェック、`article_accesses` と一致確認 | 有効なら本文返却。トークン単体では権利を付与しない（必ず D1 照合） |
| 4. 未購入/失効         | なし                          | 購入導線を表示                                | `POST /api/payments/checkout-session` へ誘導                       |

備考:

- トークンはメールリンク用の一時キー。トークン失効でも `article_accesses` が有効なら再発行で復旧可能。
- `article_accesses.expires_at` が過去なら無効扱い。
