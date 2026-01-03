# Category Specification

ブログ記事に付与するカテゴリーの仕様と API インターフェースを定義します。カテゴリー情報は Markdown のフロントマターと D1 を同期し、Cloudflare Pages/Workers 上で提供します。

## 目的と範囲

- 記事の絞り込み・ナビゲーション用にカテゴリーを管理。
- 一覧/詳細 API を提供し、ブログ/検索/ホームの SSR で利用。
- 管理はコンテンツリポジトリの YAML (フロントマター) がソース・オブ・トゥルース。GitHub Actions で D1 へ反映。

## アーキテクチャ

- ストレージ: D1 (`categories`, `article_categories`)。キャッシュ: KV (`cache:categories`)。
- API: Hono (Pages Functions) が JSON を返却。CDN で短期キャッシュ。
- ビルド/同期: GitHub Actions で前処理結果 (`category-index.json`) を生成し、差分を D1 に upsert。

## D1 データモデル

### categories

| column        | type        | note                                          |
| ------------- | ----------- | --------------------------------------------- |
| id            | text PK     | ランダム非衝突ID (UUID/ULID)                  |
| slug          | text UNIQUE | 人間可読。APIは slug を受け取り内部で id 解決 |
| name          | text        |                                               |
| description   | text        |                                               |
| color         | text        | HEX                                           |
| image_url     | json        | `{ locale: { icon?, cover? } }`               |
| display_order | int         | 表示順制御（昇順で並べ替え）                  |
| created_at    | int (unix)  |                                               |
| updated_at    | int (unix)  |                                               |

### article_categories

| column      | type    | note   |
| ----------- | ------- | ------ |
| article_id  | text FK | 多対多 |
| category_id | text FK |        |

## API インターフェース

共通: `Content-Type: application/json`, 成功 `{ data: ... }`, エラー `{ error: { code, message } }`。

| Method/Path                            | Query/Body                                                | Response `data`                                                      | Notes                                                             |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET `/api/categories`                  | -                                                         | `{ items: CategoryWithCount[], fetchedAt }`                          | Cache `public, max-age=600`, `ETag`                               |
| GET `/api/categories/:slug`            | -                                                         | `{ category: CategoryWithCount, relatedArticles: ArticleSummary[] }` | `relatedArticles` は最新5件まで。詳細は `/api/articles?category=` |
| PUT `/api/categories/:slug` (admin)    | Body `{ name?, description?, color?, icon?, sortOrder? }` | `{ category: Category }`                                             | Cloudflare Access/Bearer                                          |
| DELETE `/api/categories/:slug` (admin) | -                                                         | `{ deleted: true }`                                                  | articles 存在時は 409                                             |

`/api/categories` レスポンス例:

```json
{
  "data": {
    "items": [
      {
        "slug": "tech",
        "name": "Tech",
        "description": "技術系の記事",
        "color": "#3366ff",
        "imageUrl": { "ja": { "icon": "/images/categories/tech-icon.png", "cover": "/images/categories/tech-cover.jpg" } },
        "displayOrder": 10,
        "articleCount": 42
      }
    ],
    "fetchedAt": 1735700000
  }
}
```

`/api/categories/:slug` レスポンス例:

```json
{
  "data": {
    "category": {
      "slug": "tech",
      "name": "Tech",
      "description": "技術系の記事",
      "color": "#3366ff",
      "imageUrl": { "ja": { "icon": "/images/categories/tech-icon.png", "cover": "/images/categories/tech-cover.jpg" } },
      "displayOrder": 10,
      "articleCount": 42
    },
    "relatedArticles": [
      {
        "slug": "hello-world",
        "title": "Hello World",
        "excerpt": "概要テキスト",
        "imageUrl": { "ja": { "thumb": "/images/articles/hello/thumb.jpg" } },
        "publishedAt": 1735689600,
        "pricing": { "JPY": { "amount": 980, "unit": "¥" } },
        "reaction": { "👍": 3 },
        "commentCount": 12
      }
    ]
  }
}
```

## API クライアント契約

- TypeScript 例:

  ```ts
  type ImageUrl = Record<string, { icon?: string; cover?: string }>;
  type Category = { slug: string; name: string; description?: string; color?: string; imageUrl?: ImageUrl; displayOrder: number }; // slug is external key; id is internal
  type CategoryWithCount = Category & { articleCount: number };
  ```

- フロント: ナビゲーション/フィルタは `/api/categories` の結果を 60 分キャッシュ。カテゴリー選択時は `/api/articles?category=...` を呼び出す。

## GitHub Actions/同期フロー

- ジョブ `category-sync` (content 更新時):
  1. Markdown フロントマターからカテゴリーを抽出し `category-index.json` を生成。
  2. D1 と差分比較し `categories` と `article_categories` を upsert/remove。
  3. 成果物と一緒に Pages にデプロイ。
- 失敗時はロールバックなしで冪等再実行可能にする (UPSERT + FK 制約)。

## 非機能

- スキーマ検証: slug は `^[a-z0-9-]+$`。重複禁止。
- 国際化: name/description は `categories_i18n` (将来拡張) でローカライズ値を管理。画像も `image_url` でロケール別に保持。
- 観測: Workers Analytics Engine にカテゴリ API のヒット数/エラー率を送信。articleCount は 1 日 1 回バッチ更新でも可。
