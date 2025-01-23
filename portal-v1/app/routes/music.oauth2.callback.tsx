import type { LoaderFunctionArgs } from "@remix-run/cloudflare"
import { oauth2Cli } from "~/.server/google/oauth2"
import { google } from "googleapis"

export const loader = async ({request}: LoaderFunctionArgs) => {
  // if (request.method !== "POST") {
  //   return json({ message: "Method not allowed" }, 405)
  // }

   // Handle the OAuth 2.0 server response
    const url = new URL(request.url)
    const reqBody = request.body
    console.log('👼 < callback: reqBody\n', JSON.stringify(reqBody, null, 2))
    
    const params = Object.fromEntries(url.searchParams.entries())    
    if (params.error) {
      // An error response e.g. error=access_denied
      console.log('Error:' + params.error);
    } else if (params["state"] !== "temp") { 
      // TODO: Check state value
      // check state value
      console.log('State mismatch. Possible CSRF attack');
    } else {
      // Get access and refresh tokens (if access_type is offline)
      const { tokens } = await oauth2Cli.getToken(params.code);
      oauth2Cli.setCredentials(tokens);
      // TODO: Store tokens in a secure way
      console.log('👼 Tokens: \n', tokens);

      await google.youtube('v3').videos.list({
        auth: oauth2Cli,
        part: ["id,snippet,contentDetails,statistics"],
        myRating: "like",
        maxResults: 20,
      }, (err, res) => {
        console.log('👼 < callback: youtube.videos.list\n', JSON.stringify(res, null, 2))

        if (err) return console.log('👼 The API returned an error:', err);
        if (!res) return console.log('👼 null or undefined response', res)
        
        const videos = res.data;
        if (!videos) return console.log('👼 null or undefined videos', videos)
        
        if (videos) {
          console.log('👼 Videos:\n' + JSON.stringify(videos, null, 2));
        } else {
          console.log('👼 No videos found.');
        }
      })
      // await google.youtube('v3').activities.list({
      //   auth: oauth2Cli,
      //   // channelId: "UCzG7IxAC0ie3hZPUB21ax6w", 
      //   mine: true,
      //   part: ["id,snippet,contentDetails"],
      //   maxResults: 20,
      // }, (err, res) => {
      //   console.log('👼 < callback: youtube.activities.list\n', JSON.stringify(res, null, 2))

      //   if (err) return console.log('👼 The API returned an error:', err);
      //   if (!res) return console.log('👼 null or undefined response', res)
        
      //   const activities = res.data.items;
      //   if (!activities) return console.log('👼 null or undefined activities', activities)
        
      //   if (activities.length) {
      //     console.log('👼 Activities:\n');
      //     activities.map((activity) => {
      //       if (!activity.snippet) return console.log('👼 null or undefined snippet', activity)
      //       console.log("👼 < activity\n", JSON.stringify(activity, null, 2))
      //     });
      //   } else {
      //     console.log('👼 No activities found.');
      //   }
      // })
    /*
      // Example of using Google Drive API to list filenames in user's Drive.
      const drive = google.drive('v3');
      drive.files.list({
        auth: oauth2Client,
        pageSize: 10,
        fields: 'nextPageToken, files(id, name)',
      }, (err1, res1) => {
        if (err1) return console.log('The API returned an error: ' + err1);
        const files = res1.data.files;
        if (files.length) {
          console.log('Files:');
          files.map((file) => {
            console.log(`${file.name} (${file.id})`);
          });
        } else {
          console.log('No files found.');
        }
      });
    } 
    */
  }
  
  return null
}

const Component = () => {
  return (
    <div className="p-10">
      <h1>Music OAuth2 Callback</h1>
    </div>
  )
}

export default Component