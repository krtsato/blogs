import { redirectOAuth2Music } from "~/.server/google/oauth2"
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
// export async function action({ request }: ActionFunctionArgs ) {
//   console.log("👼 < music_._index: request\n", JSON.stringify(request, null, 2))
//   redirectOAuth2Music()
// }

export const loader = async ({request}: LoaderFunctionArgs) => {
  console.log("👼 < music_._index\n", JSON.stringify(request, null, 2))
  await redirectOAuth2Music()

  return null
}

const Component = () => {
  return (
    <div className="p-10">
      <h1>Music</h1>
    </div>
  )
}

export default Component
