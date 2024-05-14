import { json } from "@remix-run/cloudflare"
import { useLoaderData } from "@remix-run/react"

import { listTechPosts } from "~/.server/posts/tech"
import { PostHeadline } from "~/components/posts/headline"

export const loader = async () => {
  
  const posts = await listTechPosts().catch((err) => {
    console.error(`failed to list posts: err = ${err.message}`)
    throw err
  })
  return json(posts)
}

const Component = () => {
  const posts = useLoaderData<typeof loader>()

  return (
    <div className="p-10">
      <ul className="space-y-8">
        {posts.map((post) => (
          <li key={post.slug}>
            <PostHeadline {...post} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Component
