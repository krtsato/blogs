# Search Technology Report

Article/Chat を対象に、Cloudflare 内で完結する検索方式を再評価します。NowPlaying は検索対象外とし、Article 本文は Vectorize、その他は D1 (SQLite FTS/token 検索) を主経路とします。

## 要件

| 項目           | 内容                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| 対象           | Article (タイトル/本文/カテゴリ/抜粋), Chat (本文)                         |
| 多言語         | ja/en 混在。日本語は形態素を考慮                                        |
| レイテンシ     | ≦2000ms @ Edge、コールドスタート許容                                    |
| 更新頻度       | Article: デプロイ時バッチ / Chat: 随時投稿                                 |
| 運用           | Cloudflare 内完結 (Workers/Pages/KV/D1/Vectorize)                       |
| メインシナリオ | Article 本文は Vectorize (意味検索)、Article メタ/Chat は D1 FTS (token 検索) |

## 選択肢比較

要件に沿った最小構成で比較。

| 軸         | D1 + SQLite FTS5                                | Cloudflare Vectorize                           |
| ---------- | ----------------------------------------------- | ---------------------------------------------- |
| 適用範囲   | Article メタ (title/excerpt/categories)、Chat 本文 | Article 本文 (意味検索)                           |
| 検索タイプ | トークン一致/BM25                               | kNN 類似度 (意味検索)                          |
| 多言語     | tokenizer 依存。ja は分かち書きで補完           | 多言語埋め込みモデルで精度確保                 |
| レイテンシ | 低〜中 (Edge + FTS)                             | 低〜中 (Vectorize は CF 内)                    |
| 更新       | Chat:随時 upsert、Article:デプロイ時トークン更新   | Article:デプロイ時に埋め込み生成/一括 upsert      |
| コスト     | D1 従量 (storage + query)                       | Vectorize storage + kNN request + 埋め込み生成 |
| メリット   | 実装が軽い、全文保存不要                        | 長文/曖昧検索に強い、CF 内完結                 |
| デメリット | 意味検索不可、形態素精度に依存                  | 埋め込み生成が追加。モデル/料金を確認          |

## 推奨アーキテクチャ

| 対象                                 | 検索エンジン    | インデックス格納     | 備考                                                 |
| ------------------------------------ | --------------- | -------------------- | ---------------------------------------------------- |
| Article 本文                            | Vectorize (kNN) | Vectorize に埋め込み | 返却 slug で D1 メタを取得。本文の D1 検索は行わない |
| Article メタ (title/excerpt/categories) | D1 FTS          | D1 `article_searches`   | 軽量 FTS として利用可                                |
| Chat 本文                            | D1 FTS          | D1 `chat_searches`   | 埋め込み生成なし                                     |
| NowPlaying                           | -               | -                    | 検索対象外                                           |

## 実装アウトライン

- D1 (FTS):
  - `article_searches` に `title`, `excerpt`, `tokens` を保持（ja はビルド時に分かち書きして tokens へ）。本文検索には使わず、メタ参照やタイトル/抜粋の FTS 用に残す。
  - `chat_searches` (Chat 本文 + トークン) を用意し、投稿時に upsert。
  - FTS5 tokenizer: `unicode61 remove_diacritics 1` + 事前分かち書きトークン。
- Vectorize (Article):
  - ビルド時に本文を埋め込み生成し、一括 upsert。ID は `article:{slug}`。
  - 検索時: Vectorize で kNN → 得た slug で D1 メタを取得して返却。
  - 障害時フォールバック: 本文のベクトル検索は停止するが、title/excerpt の FTS 検索は継続可能。Chat はそのまま D1 FTS で継続。
- API `/api/search` (Article/Chatのみ)
  - Query: `query`, `kinds=article,chat` (カンマ区切り), `modes=semantic,lexical` (カンマ区切り; Article=semantic, Chat=lexical を指定), `offset` (default 0), `limit`<=20。
  - Response: `{ items: SearchHit[], nextCursor? }`。`SearchHit` に `type`, `slug/id`, `title?`, `excerpt`, `publishedAt` 等。
  - hybrid: semantic (Article) + lexical を取得し、再ランキング後に返却。

## コストシミュレーション

仮単価。実際は Cloudflare の最新料金に置き換えて確認すること。

前提仮単価: Vectorize Storage $0.40/GB/月、Vectorize kNN $0.10/1k、Workers AI 埋め込み $0.10/1k、Workers 実行 $0.50/100万、D1 Storage $0.30/GB/月、D1 Query $0.20/100k。

### ケースA: Article 3,000件 / Chat 200,000件 / 検索10万回(月)

| 項目                         | 試算                          | 月額目安       |
| ---------------------------- | ----------------------------- | -------------- |
| Vectorize Storage (Article本文) | 3,000×768×4B ≒ 9MB            | ~$0.004        |
| Vectorize kNN                | 50,000 回 (blog semantic 50%) | ~$5.0          |
| 埋め込み生成                 | 3,000件/デプロイ              | ~$0.30/回      |
| Workers 実行                 | 0.1M リクエスト               | ~$0.05         |
| D1 (Chat FTS + Articleメタ)     | 200MB ストレージ + 50k クエリ | ~$0.16         |
| 合計                         |                               | **約 $5.5〜6** |

### ケースB: Article 20,000件 / Chat 1,000,000件 / 検索50万回(月)

| 項目                     | 試算                         | 月額目安                         |
| ------------------------ | ---------------------------- | -------------------------------- |
| Vectorize Storage        | 約 60MB                      | ~$0.024                          |
| Vectorize kNN            | 250,000 回                   | ~$25                             |
| 埋め込み生成             | 20,000件/デプロイ            | ~$2/回（週1なら ~$8/月）         |
| Workers 実行             | 0.5M リクエスト              | ~$0.25                           |
| D1 (Chat FTS + Articleメタ) | 1GB ストレージ + 250k クエリ | ~$0.80                           |
| 合計                     | -                            | **約 $26〜34**（再生成頻度次第） |

メモ: ベクトルストレージコストは小さく、kNN リクエスト数と埋め込み再生成頻度が主要ドライバ。Chat は FTS のみで追加コストは僅少。実単価を必ず確認し、semantic/lexical 比率でトラフィックを調整してコストを最適化すること。

## リスクと方針

| リスク                | 方針                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Vectorize 障害/未生成 | Article の本文ベクトル検索は停止し、title/excerpt/categories の FTS 検索のみ提供（メタ検索）。Chat は D1 FTS で継続 |
| 更新遅延              | デプロイ失敗時は旧ベクトルが残るが検索は継続。監視で検知                                                         |
| モデル依存            | 埋め込みモデル更新時は再生成ジョブを実行し、モデル固定版を管理                                                   |
| プライバシー          | クエリはログしない/ハッシュ化。ベクトルに PII を含めない                                                         |
