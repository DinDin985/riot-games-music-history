import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect } from "effect"
import { paths } from "../paths.ts"
import * as Process from "../services/Process.ts"

/**
 * League of Legends on SoundCloud (https://soundcloud.com/leagueoflegends) as a
 * source of official artwork. Its audio is DRM protected, so this stage reads
 * METADATA ONLY (`--skip-download --ignore-no-formats-error`): title, credits,
 * release date, duration and the original artwork URL.
 *
 * 1. Flat-list the tracks tab (fast: ids + URLs only).
 * 2. Resolve tracks not already in soundcloud.jsonl (resumable, one polite process); yt-dlp
 *    exits non-zero when any entry fails, so output is read leniently.
 * 3. Flat-list every set (album / playlist) for track → set membership.
 *
 * Output: data/sources/soundcloud.jsonl — one SoundCloudTrack per line.
 */
export const SOUNDCLOUD_PROFILE = "https://soundcloud.com/leagueoflegends"
export const soundcloudFile = NodePath.join(paths.sources, "soundcloud.jsonl")
const workDir = NodePath.join(paths.media, "logs", "soundcloud")

export interface SoundCloudTrack {
  readonly id: string
  readonly url: string
  readonly title: string
  /** SoundCloud "artist" metadata, e.g. "League of Legends, Pentakill". */
  readonly artist: string | null
  readonly genre: string | null
  readonly releaseDate: string | null
  readonly uploadDate: string | null
  readonly duration: number | null
  /** Full-resolution artwork (`…-original.jpg`), null when the track has none. */
  readonly artworkUrl: string | null
  readonly sets: ReadonlyArray<{ readonly title: string; readonly url: string; readonly position: number }>
}

interface RawEntry {
  readonly id?: string
  readonly webpage_url?: string
  readonly title?: string
  readonly artist?: string | null
  readonly genre?: string | null
  readonly release_date?: string | null
  readonly upload_date?: string | null
  readonly duration?: number | null
  readonly thumbnails?: ReadonlyArray<{ readonly id?: string; readonly url?: string }>
  readonly thumbnail?: string | null
}

const iso = (yyyymmdd: string | null | undefined) =>
  yyyymmdd && /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}` : null

const artworkOf = (entry: RawEntry) => {
  const url = entry.thumbnails?.find((t) => t.id === "original")?.url ?? entry.thumbnails?.at(-1)?.url ?? entry.thumbnail ?? null
  // Tracks without artwork fall back to the account avatar — that is not album art.
  return url && /\/artworks-/.test(url) ? url : null
}

/** `--flat-playlist` lines: "<id>\t<title>\t<url>" (and the playlist title for sets). */
const flatList = (url: string, template: string) =>
  Process.runLenient("yt-dlp", ["--flat-playlist", "--no-warnings", "--print", template, url]).pipe(
    Effect.map(({ stdout }) => stdout.split(/\r?\n/).filter((line) => line.trim().length > 0)),
  )

const resolveBatch = (file: string) =>
  Process.runLenient("yt-dlp", [
    "--sleep-requests",
    "1.5",
    "--skip-download",
    "--ignore-no-formats-error",
    "--ignore-errors",
    "--no-warnings",
    "-j",
    "-a",
    file,
  ]).pipe(
    Effect.map(({ stdout }) =>
      stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("{"))
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as RawEntry]
          } catch {
            return []
          }
        }),
    ),
  )

export const soundcloudStage = Effect.gen(function* () {
  NodeFs.mkdirSync(workDir, { recursive: true })

  // 1. Every track URL.
  const listing = yield* flatList(`${SOUNDCLOUD_PROFILE}/tracks`, "%(id)s\t%(url)s")
  const urls = [...new Set(listing.map((line) => line.split("\t")[1] ?? "").filter((u) => u.startsWith("https://")))]
  // 2. Metadata for tracks not resolved by an earlier run, in ONE polite process:
  //    SoundCloud answers bursts (parallel batches) with HTTP 403 for a while.
  const tracks = new Map<string, SoundCloudTrack & { sets: Array<SoundCloudTrack["sets"][number]> }>()
  if (NodeFs.existsSync(soundcloudFile))
    for (const line of NodeFs.readFileSync(soundcloudFile, "utf8").split(/\r?\n/))
      if (line.startsWith("{")) {
        const track = JSON.parse(line) as SoundCloudTrack
        tracks.set(track.id, { ...track, sets: [...track.sets] })
      }
  const known = new Set([...tracks.values()].map((t) => t.url))
  const missing = urls.filter((u) => !known.has(u))
  yield* Effect.logInfo(`SoundCloud: ${urls.length} tracks listed, ${tracks.size} already resolved, ${missing.length} to resolve`)
  const file = NodePath.join(workDir, "missing.txt")
  NodeFs.writeFileSync(file, missing.join("\n") + "\n", "utf8")
  const entries = missing.length > 0 ? yield* resolveBatch(file) : []
  if (missing.length > 0 && entries.length === 0)
    yield* Effect.logWarning("SoundCloud resolved nothing new — probably rate-limited (HTTP 403). Re-run later; progress is kept.")
  for (const entry of entries) {
    if (!entry.id || !entry.title || tracks.has(entry.id)) continue
    tracks.set(entry.id, {
      id: entry.id,
      url: entry.webpage_url ?? "",
      title: entry.title,
      artist: entry.artist ?? null,
      genre: entry.genre ?? null,
      releaseDate: iso(entry.release_date),
      uploadDate: iso(entry.upload_date),
      duration: entry.duration ?? null,
      artworkUrl: artworkOf(entry),
      sets: [],
    })
  }
  yield* Effect.logInfo(`SoundCloud: ${tracks.size}/${urls.length} tracks resolved`)

  // 3. Set membership (album names) from flat set listings.
  const setLines = yield* flatList(`${SOUNDCLOUD_PROFILE}/sets`, "%(url)s")
  const sets = [...new Set(setLines.filter((line) => line.startsWith("https://")))]
  yield* Effect.forEach(
    sets,
    (setUrl) =>
      flatList(setUrl, "%(playlist_title)s\t%(playlist_index)s\t%(id)s").pipe(
        Effect.tap((lines) =>
          Effect.sync(() => {
            for (const line of lines) {
              const [title = "", position = "0", id = ""] = line.split("\t")
              const track = tracks.get(id)
              if (track && !track.sets.some((s) => s.url === setUrl))
                track.sets.push({ title, url: setUrl, position: Number(position) || 0 })
            }
          }),
        ),
      ),
    { concurrency: 1, discard: true },
  )

  const rows = [...tracks.values()].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
  NodeFs.writeFileSync(soundcloudFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8")
  yield* Effect.logInfo(
    `Wrote ${soundcloudFile}: ${rows.length} tracks, ${rows.filter((r) => r.artworkUrl).length} with their own artwork, ${rows.filter((r) => r.sets.length > 0).length} in ${sets.length} sets`,
  )
})
