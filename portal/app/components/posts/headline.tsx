import { Link } from "@remix-run/react"

import type { PostMeta, PublishMeta } from "~/types/posts"

export const PostHeadline = ({ slug, frontmatter }: PostMeta) => (
    <article className="space-y-2">
      <Link to={slug}>
        <h3 className="text-3xl font-bold">{frontmatter.title}</h3>
      </Link>
      <p className="text-gray-600">{frontmatter.description}</p>
      <PostPublishMeta publishAt={frontmatter.publishAt} />
    </article>
  )

export const PostPublishMeta = ({ publishAt }: PublishMeta) => (
  <time
    className="block text-sm text-gray-500"
    dateTime={publishAt}
  >
    {publishAt}
  </time>
)