export type Frontmatter = {
  title: string
  description: string
  publishAt: string; // YYYY-MM-DD HH:MM:SS
  isFeatured: boolean
}

export type PostMeta = {
  slug: string
  frontmatter: Frontmatter
}

export type PublishMeta = {
  publishAt: string
}

export type ListPostsQuery = {
  isFeatured?: boolean
  slugPrefix?: string
}
