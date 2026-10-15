// @ts-check
/**
 * Stand-alone `/media` server for previewing the built story pages without the
 * Next.js app: `npm run media -w stories` (port 4322), then
 * `STORIES_PROXY_ORIGIN=http://localhost:4322 npm run preview -w stories`.
 */
import * as NodeHttp from "node:http"
import { mediaMiddleware, mediaRoot } from "./media-middleware.mjs"

const port = Number(process.env.STORIES_MEDIA_PORT ?? 4322)

NodeHttp.createServer((req, res) =>
  mediaMiddleware(req, res, () => {
    res.statusCode = 404
    res.end("Only /media/* is served here")
  }),
).listen(port, () => console.log(`Serving ${mediaRoot()} at http://localhost:${port}/media/`))
