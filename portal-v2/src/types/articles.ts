export type ImageUrl = Record<string, { cover?: string; og?: string; thumb?: string }>;
export type PricingMap = Record<string, { amount: number; unit: string }>;

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  imageUrl: ImageUrl;
  categories: string[];
  publishedAt: number;
  isFeatured: boolean;
  pricing: PricingMap;
  reaction?: Record<string, number>;
  commentCount: number;
};

export type ArticleDetail = ArticleSummary & {
  bodyHtml: string | null;
  paywall: { required: boolean; reason: string } | null;
  permission: { read: boolean; comment: boolean };
  readingTimeSec: number;
  contentPath: string;
  updatedAt: number;
};
