import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect, Option } from "effect"
import type { Catalog } from "../catalog/types.ts"
import { paths } from "../paths.ts"
import { run, runBytes, runStdout } from "../services/Process.ts"

/**
 * File and ffmpeg helpers shared by the media analysis stages
 * (extract-audio, analyze, covers, align, gifs).
 */

export const analysisFile = (youtubeId: string) => NodePath.join(paths.analysis, `${youtubeId}.json`)
export const paletteFile = (youtubeId: string) => NodePath.join(paths.analysis, "palette", `${youtubeId}.json`)
export const alignFile = (songId: string, videoId: string) =>
  NodePath.join(paths.analysis, "align", `${songId}__${videoId}.json`)
export const coverFile = (youtubeId: string) => NodePath.join(paths.covers, `${youtubeId}.jpg`)
export const thumbFile = (youtubeId: string) => NodePath.join(paths.thumbs, `${youtubeId}.jpg`)
export const gifFile = (songId: string) => NodePath.join(paths.gifs, `${songId}.gif`)
/** Sidecar recording which video moment a song's GIF shows (used for freshness and by build-db). */
export const gifInfoFile = (songId: string) => NodePath.join(paths.analysis, "gif", `${songId}.json`)
export const clipFile = (slug: string, ext: "mp4" | "gif") => NodePath.join(paths.clips, `${slug}.${ext}`)
export const clipInfoFile = (slug: string) => NodePath.join(paths.analysis, "clips", `${slug}.json`)
export const catalogFile = NodePath.join(paths.data, "catalog.json")

const mtime = (file: string): number | null => {
  try {
    return NodeFs.statSync(file).mtimeMs
  } catch {
    return null
  }
}

export const exists = (file: string): boolean => mtime(file) !== null

/** `output` exists and is at least as new as every existing input. */
export const isFresh = (output: string, inputs: ReadonlyArray<string>): boolean => {
  const out = mtime(output)
  if (out === null) return false
  return inputs.every((input) => (mtime(input) ?? 0) <= out)
}

export const readJson = <A>(file: string): A | null => {
  try {
    return JSON.parse(NodeFs.readFileSync(file, "utf8")) as A
  } catch {
    return null
  }
}

/** Write via a temp file + rename, so readers never see half a file. */
export const writeFileAtomic = (file: string, data: string | Uint8Array): void => {
  NodeFs.mkdirSync(NodePath.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  NodeFs.writeFileSync(temp, data)
  NodeFs.renameSync(temp, file)
}

export const writeJson = (file: string, value: unknown): void =>
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n")

/** `<dir>/<name>.<pid>.tmp<ext>` next to `file`, for tools (ffmpeg) that pick the format from the extension. */
export const tempPath = (file: string): string => {
  const ext = NodePath.extname(file)
  return NodePath.join(NodePath.dirname(file), `${NodePath.basename(file, ext)}.${process.pid}.tmp${ext}`)
}

export const commitTemp = (temp: string, file: string): void => NodeFs.renameSync(temp, file)

export const removeQuietly = (file: string): void => {
  try {
    NodeFs.rmSync(file, { force: true })
  } catch {
    // ignore
  }
}

/** Ids of the `*.<ext>` files in a media folder (missing folder → none). */
export const listIds = (dir: string, ext: string): ReadonlyArray<string> => {
  try {
    return NodeFs.readdirSync(dir)
      .filter((name) => name.endsWith(ext) && !name.includes(".tmp"))
      .map((name) => name.slice(0, -ext.length))
      .sort()
  } catch {
    return []
  }
}

/** `data/catalog.json`, if the catalog stage has produced it. */
export const readCatalog = Effect.sync(() => Option.fromNullishOr(readJson<Catalog>(catalogFile)))

export interface StreamInfo {
  readonly audioCodec: string | null
  readonly audioStart: number
  readonly videoStart: number | null
  /** Container duration, seconds. */
  readonly duration: number | null
  /** Coded frame size of the video stream. */
  readonly width: number | null
  readonly height: number | null
}

interface FfprobeJson {
  readonly streams?: ReadonlyArray<{
    codec_type?: string
    codec_name?: string
    start_time?: string
    width?: number
    height?: number
  }>
  readonly format?: { duration?: string }
}

/** Stream start times and codecs via ffprobe. */
export const probe = (file: string) =>
  runStdout("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,start_time,width,height:format=duration",
    "-of",
    "json",
    file,
  ]).pipe(
    Effect.map((stdout): StreamInfo => {
      const json = JSON.parse(stdout) as FfprobeJson
      const audio = json.streams?.find((s) => s.codec_type === "audio")
      const video = json.streams?.find((s) => s.codec_type === "video")
      const num = (value: string | undefined) => {
        const n = Number(value)
        return value !== undefined && Number.isFinite(n) ? n : null
      }
      return {
        audioCodec: audio?.codec_name ?? null,
        audioStart: num(audio?.start_time) ?? 0,
        videoStart: video ? (num(video.start_time) ?? 0) : null,
        duration: num(json.format?.duration),
        width: video?.width ?? null,
        height: video?.height ?? null,
      }
    }),
  )

/** Decode the first audio stream to mono little-endian f32 PCM at `sampleRate`. */
export const decodePcm = (file: string, sampleRate: number) =>
  runBytes("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-i",
    file,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-f",
    "f32le",
    "-",
  ])

/** Run ffmpeg quietly (errors carry the stderr tail). */
export const ffmpeg = (args: ReadonlyArray<string>) => run("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args])

/** Throttled progress logging for long batches. */
export const progressLogger = (label: string, total: number, everySeconds = 15) => {
  const started = Date.now()
  let lastLog = 0
  let done = 0
  return (force = false) =>
    Effect.suspend(() => {
      done++
      const now = Date.now()
      if (!force && done !== total && now - lastLog < everySeconds * 1000) return Effect.void
      lastLog = now
      const elapsed = (now - started) / 1000
      const eta = done > 0 ? (elapsed / done) * (total - done) : 0
      return Effect.logInfo(`${label}: ${done}/${total} (${elapsed.toFixed(0)} s elapsed, ~${eta.toFixed(0)} s left)`)
    })
}

export const seconds = (startedAt: number) => `${((Date.now() - startedAt) / 1000).toFixed(1)} s`

/** One-line description of a stage error for logs. */
export const describe = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const e = error as { _tag?: string; message?: string; output?: string }
    return [e._tag, e.message, e.output?.slice(-300)].filter(Boolean).join(": ")
  }
  return String(error)
}
