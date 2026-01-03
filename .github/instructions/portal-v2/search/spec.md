# Search Specification

Article/Chat の検索仕様を定義します。Article 本文は Vectorize による意味検索、Article メタと Chat は D1 FTS（token 検索）を利用します。NowPlaying は対象外です。

## 要件

| 項目       | 内容                                                  |
| ---------- | ----------------------------------------------------- |
| 対象       | Article (タイトル/本文/カテゴリ/抜粋), Chat (本文)    |
| 多言語     | ja/en 混在。日本語は分かち書きで補完                  |
| レイテンシ | ≦2000ms @ Edge、コールドスタート許容                  |
| 更新頻度   | Article: デプロイ時バッチ、Chat: 随時投稿             |
| 運用       | Cloudflare 内完結 (Workers/Pages/KV/D1/Vectorize)     |
| メイン方針 | Article 本文は Vectorize、Article メタ/Chat は D1 FTS |

## データ/インデックス

| 対象                 | ストア                | 内容                                    | 備考                                   |
| -------------------- | --------------------- | --------------------------------------- | -------------------------------------- |
| Article 本文ベクトル | Vectorize             | 埋め込みベクトル (ID: `article:{slug}`) | kNN 検索用                             |
| Article メタ FTS     | D1 `article_searches` | `title`, `excerpt`, `tokens`            | 本文検索なし。title/抜粋カテゴリの補助 |
| Chat FTS             | D1 `chat_searches`    | 本文 + トークン                         | 投稿時 upsert                          |

### トークナイズ/分かち書き

- Article メタ/Chat: ビルド/投稿時に日本語分かち書きした tokens を FTS に格納。
- FTS5 tokenizer: `unicode61 remove_diacritics 1`（必要なら自前トークンフィード）。

## パイプライン（ベクトル生成は CD 上）

| フェーズ         | 実行場所          | 処理                                                       | 留意点                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| ビルド (Article) | GitHub Actions CD | Markdown 前処理 → 本文埋め込み生成 → Vectorize 一括 upsert | 処理が長く料金上昇の恐れ。対象記事を選択できる CLI/ENV を用意 |
| デプロイ         | GitHub Actions CD | Workers/Pages デプロイ                                     | Vectorize 更新と同期                                          |
| Chat 投稿        | Workers           | Chat 本文を D1 FTS に upsert                               | ベクトル生成なし                                              |
| ローカル代替     | 開発者ローカル    | CLI で埋め込み生成+upsert を実行（記事選択可能）           | Actions 時間削減                                              |

### ベクトル生成のスコープ制御

- ENV/CLI で対象スラッグを指定 (`VEC_TARGET=slug1,slug2`)、または `--changed-only` で差分記事のみ生成。
- 生成済みキャッシュを活用して再生成を避ける。

## API

共通レスポンス: 成功 `{ data: ... }`, エラー `{ error: { code, message } }`。日時は unix time (秒)。

| Method/Path       | Query/Body                                                                                                                                                                                        | Response `data`                                 | Notes                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET `/api/search` | `query`, `kinds=article,chat` (カンマ区切りで対象指定), `modes=semantic,lexical` (カンマ区切りで検索方式。例: Article は `semantic`, Chat は `lexical` を指定), `offset` (default 0), `limit`<=20 | `{ items: SearchHit[], offset, limit, total? }` | `modes` に `hybrid`/`all` は使わない。semantic: Vectorize (Article)、lexical: D1 FTS (Articleメタ/Chat) |

`SearchHit` 例:

```json
{ "type": "article", "slug": "hello-world", "title": "Hello World", "excerpt": "概要テキスト", "publishedAt": 1735689600 }
```

## エラー/フォールバック

| 障害                  | 対応                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Vectorize 障害/未生成 | Article 本文の semantic 検索は停止。title/excerpt/categories の FTS 検索のみ提供（メタ検索）。Chat は D1 FTS で継続 |
| D1 障害               | Chat 検索不可。Article メタ検索不可。Vectorize で本文のみ返せるがメタ取得失敗時は空レスポンス                       |

## 運用・監視

| 項目         | 内容                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| モニタリング | Vectorize kNN 失敗率、D1 エラー、生成ジョブ時間を Workers Analytics/Actions ログで監視 |
| アラート     | Vectorize/D1 エラー閾値超過で通知                                                      |
| PII 対策     | クエリはログしない/ハッシュ化。ベクトルに PII を含めない                               |

## コスト留意

- コストドライバ: Vectorize kNN リクエスト数、埋め込み生成回数、Workers 実行。ベクトルストレージは小さい。
- 高負荷時は `mode=lexical` をデフォルトにする、またはベクトル生成対象を絞ることでコストを抑制。
