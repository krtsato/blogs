import { sortBy } from "~/.server/utils/utils"
import type { Frontmatter, PostMeta, ListPostsQuery } from "~/types/posts"

export const listTechPosts = async (query: ListPostsQuery = {}): Promise<PostMeta[]> => {
  const modules = import.meta.glob<{ frontmatter: Frontmatter }>(
    "../../routes/tech.*.mdx",
    { eager: true }
  )

  const build = await import("virtual:remix/server-build")
  const posts = Object.entries(modules).map(([file, post]) => {
    const id = file.replace("../../", "").replace(/\.mdx$/, "")

    const _slug = build.routes[id]?.path
    if (_slug === undefined) throw new Error(`No route for ${id}`)
    const slug = (query.slugPrefix) ? query.slugPrefix.concat("/", _slug) : _slug

    return {
      slug,
      frontmatter: post.frontmatter,
    }
  }).filter((post) =>
    (query.isFeatured && !post.frontmatter.isFeatured) ? false : true
  )

  return sortBy(posts, (post) => post.frontmatter.publishAt, "desc")
}

