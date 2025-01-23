import { google } from "googleapis"
import { redirect } from "@remix-run/cloudflare"

// TODO: Set as env variables
const CLIENT_ID = "1064745449991-c6gsg8nqmosl58cvr4ahdqn3or1vde50.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const REDIRECT_URL = "http://localhost:5173/music/oauth2/callback"

// TODO: Set as env variables
export const oauth2Cli = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL,
)

// Access scopes for read-only Drive activity.
const scopes: string[] = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
]

export const redirectOAuth2Music = async () => {
  console.log("👼 < redirectOAuth2Music")

  // TOOD: Generate a random state value
  // import { randomBytes } from 'crypto'
  // const state = randomBytes(32).toString('hex')
  const state = "temp"

  // Store state in the session
  // req.session.state = state

  let authUrl: string
  try {
    authUrl = oauth2Cli.generateAuthUrl({
      access_type: "offline", // offline gets refresh_token
      scope: scopes,
      include_granted_scopes: true, // Enable incremental authorization
      state: state, // Include the state parameter to reduce the risk of CSRF attacks
    })

  } catch (err) {
    console.error(`failed to generate auth url: err = ${err}`)
    throw err
  }

  console.log("👼 < authURL\n", authUrl)

  redirect(authUrl, {
    status: 302,
    headers: {
      "GOOGLE-OAUTH2": state
    },
  })
}
