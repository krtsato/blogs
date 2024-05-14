import { useLoaderData } from "@remix-run/react";
import { listTechPosts } from "~/.server/posts/tech"
import { PostHeadline } from "~/components/posts/headline"
import { type MetaFunction, json } from "@remix-run/cloudflare"
import type { ListPostsQuery } from "~/types/posts"


export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    {
      name: "description",
      content: "Welcome to Remix! Using Vite and Cloudflare!",
    },
  ]
}

export const loader = async () => {
  const query: ListPostsQuery = { isFeatured: true }
  const techPosts = await listTechPosts(query).catch((err) => {
    console.error(`failed to list posts: err = ${err.message}`)
    throw err
  })
  return json(techPosts)
}

export default function Index() {
  const featuredPosts = useLoaderData<typeof loader>();

  return (
    <div className="grid flex-1 gap-16 p-10 sm:grid-cols-2 sm:place-items-center">
      <div className="space-y-8">
        <div>
          <h2 className="text-4xl font-bold">Sakurada.io</h2>
          <p className="font-light text-gray-600">
            Portal site owned by Kei Sakurada.
          </p>
        </div>
        <hr />
        <section>
          <h3 className="text-xl tracking-wide">📍 Featured</h3>
          <ul className="mt-4 space-y-8">
            {featuredPosts.map((post) => (
              <li key={post.slug}>
                <PostHeadline {...post} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="hidden sm:block">
        <img
          src="/me.png"
          alt="Abstract sculpture with different colorful shapes"
        />
      </div>
    </div>
  );
}
