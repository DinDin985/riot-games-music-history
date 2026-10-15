// @ts-check
/**
 * Minimal `/media/*` file server with HTTP Range support, used only for local
 * development of the story pages (`astro dev` middleware and
 * `npm run media -w stories`). In production the Next.js app serves `/media`.
 */
import * as NodeFs from "node:fs"
import * as NodePath from "node:path"

const MIME = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
}

/** Walk up from `from` to the directory containing `turbo.json` (same rule as @workspace/db findRepoRoot). */
export const findRepoRoot = (from = process.cwd()) => {
  let dir = NodePath.resolve(from)
  for (;;) {
    if (NodeFs.existsSync(NodePath.join(dir, "turbo.json"))) return dir
    const parent = NodePath.dirname(dir)
    if (parent === dir) return NodePath.resolve(from)
    dir = parent
  }
}

export const mediaRoot = () => process.env.RIOT_MUSIC_MEDIA ?? NodePath.join(findRepoRoot(), "media")

/**
 * Connect-style middleware: handles GET/HEAD `/media/<path>` and calls `next()`
 * for everything else.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {() => void} next
 */
export const mediaMiddleware = (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/media/") || (req.method !== "GET" && req.method !== "HEAD")) return next()
  const root = NodePath.resolve(mediaRoot())
  const file = NodePath.resolve(root, decodeURIComponent(url.pathname.slice("/media/".length)))
  // Never escape the media folder.
  if (!file.startsWith(root + NodePath.sep)) {
    res.statusCode = 403
    return res.end()
  }
  let stat
  try {
    stat = NodeFs.statSync(file)
  } catch {
    res.statusCode = 404
    return res.end("Not found")
  }
  if (!stat.isFile()) {
    res.statusCode = 404
    return res.end("Not found")
  }
  const type = MIME[/** @type {keyof typeof MIME} */ (NodePath.extname(file).toLowerCase())] ?? "application/octet-stream"
  res.setHeader("Content-Type", type)
  res.setHeader("Accept-Ranges", "bytes")
  res.setHeader("Cache-Control", "public, max-age=3600")
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "")
  let start = 0
  let end = stat.size - 1
  if (range) {
    if (range[1] === "" && range[2] !== "") {
      start = Math.max(0, stat.size - Number(range[2]))
    } else {
      start = Number(range[1] || 0)
      if (range[2] !== "") end = Math.min(end, Number(range[2]))
    }
    if (start > end || start >= stat.size) {
      res.statusCode = 416
      res.setHeader("Content-Range", `bytes */${stat.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`)
  }
  res.setHeader("Content-Length", String(end - start + 1))
  if (req.method === "HEAD") return res.end()
  NodeFs.createReadStream(file, { start, end }).pipe(res)
}
