import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Readable } from "node:stream"
import type { NextRequest } from "next/server"
import { mediaRoot } from "@workspace/db/paths"

/**
 * GET/HEAD /media/<path> — serves the git-ignored `media/` folder (audio,
 * videos, thumbnails, covers, GIFs, clips, analysis JSON).
 *
 * - HTTP Range (single range): `206 Partial Content` + `Content-Range`, so
 *   <audio>/<video> can seek inside 18 GB of music videos.
 * - Files are streamed from disk (`fs.createReadStream`), never buffered whole.
 * - Path traversal is rejected; only whitelisted extensions are served.
 * - Conditional requests via ETag / Last-Modified (304).
 * - Long cache lifetimes; `no-transform` keeps Next's gzip off byte ranges.
 */

export const dynamic = "force-dynamic"

type MediaContext = { params: Promise<{ path: string[] }> }

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".json": "application/json; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
}

/** Folders whose files are keyed by YouTube id and never change once written. */
const IMMUTABLE_DIRS = new Set(["audio", "video", "thumbs"])

function resolveMediaPath(segments: ReadonlyArray<string>): string | null {
  if (segments.length === 0 || segments.length > 8) return null
  for (const seg of segments) {
    // Next has already URL-decoded the segments; reject anything that could escape.
    if (seg === "" || seg === "." || seg === ".." || /[\\/:\0]/.test(seg) || seg.startsWith(".")) return null
  }
  const root = NodePath.resolve(mediaRoot())
  const full = NodePath.resolve(root, ...segments)
  const rel = NodePath.relative(root, full)
  if (rel.startsWith("..") || NodePath.isAbsolute(rel)) return null
  return full
}

/** Parse a single `bytes=` range. `null` = ignore the header, `"invalid"` = 416. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.split(",")[0]!.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === "" && b === "") return "invalid"
  let start: number
  let end: number
  if (a === "") {
    // Suffix range: the last N bytes.
    const n = Number(b)
    if (n === 0) return "invalid"
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid"
  return { start, end }
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

async function serve(request: NextRequest, ctx: MediaContext, withBody: boolean) {
  const { path } = await ctx.params
  const file = resolveMediaPath(path)
  if (!file) return notFound()
  const contentType = CONTENT_TYPES[NodePath.extname(file).toLowerCase()]
  if (!contentType) return notFound()

  let stat: NodeFs.Stats
  try {
    stat = await NodeFs.promises.stat(/*turbopackIgnore: true*/ file)
  } catch {
    return notFound()
  }
  if (!stat.isFile()) return notFound()

  const size = stat.size
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const lastModified = stat.mtime.toUTCString()
  const cacheControl = IMMUTABLE_DIRS.has(path[0]!)
    ? "public, max-age=31536000, immutable, no-transform"
    : "public, max-age=86400, stale-while-revalidate=604800, no-transform"

  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
  })

  const ifNoneMatch = request.headers.get("if-none-match")
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === "*")) {
    return new Response(null, { status: 304, headers })
  }

  // If-Range: only honour the Range header when the validator still matches.
  const ifRange = request.headers.get("if-range")
  const rangeHeader = ifRange && ifRange !== etag && ifRange !== lastModified ? null : request.headers.get("range")
  const range = parseRange(rangeHeader, size)

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const length = size === 0 ? 0 : end - start + 1
  headers.set("Content-Length", String(length))
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200

  if (!withBody || length === 0) return new Response(null, { status, headers })

  const stream = NodeFs.createReadStream(/*turbopackIgnore: true*/ file, { start, end, highWaterMark: 256 * 1024 })
  // Media elements abort range requests constantly while seeking: stop reading.
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true })
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
}

export function GET(request: NextRequest, ctx: MediaContext) {
  return serve(request, ctx, true)
}

export function HEAD(request: NextRequest, ctx: MediaContext) {
  return serve(request, ctx, false)
}
