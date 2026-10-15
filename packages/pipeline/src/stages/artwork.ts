import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect, Option, Ref } from "effect"
import { Command, Flag } from "effect/cli"
import sharp from "sharp"
import {
  commitTemp,
  describe,
  progressLogger,
  readCatalog,
  readJson,
  seconds,
  tempPath,
  writeJson,
} from "../analysis/media-io.ts"
import { extractPalette } from "../analysis/palette.ts"
import {
  type ArtworkCandidate,
  type ArtworkMatch,
  indexCandidates,
  matchSong,
  type SongForArtwork,
} from "../artwork/match.ts"
import type { AudioAnalysisFile, Catalog, PaletteFile } from "../catalog/types.ts"
import { songsForArtwork } from "../artwork/songs.ts"
import { paths } from "../paths.ts"
import { forceFlag } from "../workers/flags.ts"
import { type AppleTrack, appleFile } from "./apple.ts"
import { type SoundCloudTrack, soundcloudFile } from "./soundcloud.ts"

/**
 * `artwork`: official album covers for every song.
 *
 * 1. Match each catalog song to its official cover: Apple Music (the `apple`
 *    stage — Riot's artist pages, as shown on coveratlas.com), SoundCloud
 *    (soundcloud.com/leagueoflegends, the `soundcloud` stage) or Spotify release
 *    art (data/curated/spotify.json) → data/curated/artwork/matches.json.
 * 2. data/curated/artwork/overrides.json (human/agent review) wins over the
 *    automatic match: pick another candidate, a direct URL, or "keep" the
 *    YouTube-derived cover.
 * 3. Download the chosen art (media/artwork/<source>-<id>.jpg) and render
 *    media/covers/song-<songId>.jpg (600×600) + media/analysis/palette/song-<songId>.json,
 *    which build-db prefers over the YouTube thumbnail cover.
 */

export const artworkDir = NodePath.join(paths.curated, "artwork")
export const matchesFile = NodePath.join(artworkDir, "matches.json")
export const overridesFile = NodePath.join(artworkDir, "overrides.json")
/** Reviewers write one file each here (e.g. overrides/review-1.json); later files win on conflicts. */
export const overridesDir = NodePath.join(artworkDir, "overrides")

/** overrides.json plus every overrides/*.json (sorted by name), merged. */
export const readOverrides = (): Record<string, ArtworkOverride> => {
  const files = NodeFs.existsSync(overridesDir)
    ? NodeFs.readdirSync(overridesDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => NodePath.join(overridesDir, f))
    : []
  const merged: Record<string, ArtworkOverride> = {}
  for (const file of [overridesFile, ...files]) Object.assign(merged, readJson<Record<string, ArtworkOverride>>(file) ?? {})
  return merged
}
const sourceArtDir = NodePath.join(paths.media, "artwork")

export const songCoverKey = (songId: string) => `song-${songId}`
export const songCoverFile = (songId: string) => NodePath.join(paths.covers, `${songCoverKey(songId)}.jpg`)
export const songPaletteFile = (songId: string) => NodePath.join(paths.analysis, "palette", `${songCoverKey(songId)}.json`)

/** One reviewed decision. `keep` = leave the YouTube-derived cover; `url` = any official artwork URL. */
export type ArtworkOverride =
  | { readonly action: "apple"; readonly id: string; readonly note?: string }
  | { readonly action: "soundcloud"; readonly id: string; readonly note?: string }
  | { readonly action: "spotify"; readonly id: string; readonly note?: string }
  | { readonly action: "url"; readonly url: string; readonly pageUrl?: string; readonly note?: string }
  | { readonly action: "keep"; readonly note?: string }

const COVER_SIZE = 600

interface SpotifyFile {
  readonly releases: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly releaseDate: string | null
    readonly coverUrl: string | null
    readonly url: string
    readonly tracks: ReadonlyArray<{ readonly title: string; readonly artists: ReadonlyArray<string>; readonly durationMs: number | null }>
  }>
}

const readJsonl = <A>(file: string): ReadonlyArray<A> =>
  NodeFs.existsSync(file)
    ? NodeFs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => JSON.parse(l) as A)
    : []

const readSoundCloud = (): ReadonlyArray<SoundCloudTrack> =>
  NodeFs.existsSync(soundcloudFile)
    ? NodeFs.readFileSync(soundcloudFile, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => JSON.parse(l) as SoundCloudTrack)
    : []

export const loadCandidates = (): ReadonlyArray<ArtworkCandidate> => {
  const apple: Array<ArtworkCandidate> = readJsonl<AppleTrack>(appleFile).map((t) => ({
    source: "apple",
    id: String(t.collectionId),
    title: t.trackName,
    artists: [t.artistName],
    duration: t.durationMs !== null ? t.durationMs / 1000 : null,
    artworkUrl: t.artworkUrl,
    pageUrl: t.collectionUrl ?? t.trackUrl ?? "",
    album: t.collectionName,
    releaseDate: t.releaseDate,
    collectionKind: t.collectionKind,
  }))
  const sc: Array<ArtworkCandidate> = readSoundCloud()
    .filter((t) => t.artworkUrl)
    .map((t) => ({
      source: "soundcloud",
      id: t.id,
      title: t.title,
      artists: t.artist ? [t.artist] : [],
      duration: t.duration,
      artworkUrl: t.artworkUrl!,
      pageUrl: t.url,
      album: t.sets[0]?.title ?? null,
      releaseDate: t.releaseDate ?? t.uploadDate,
    }))
  const spotify = readJson<SpotifyFile>(NodePath.join(paths.curated, "spotify.json"))
  const sp: Array<ArtworkCandidate> = (spotify?.releases ?? []).flatMap((r) =>
    r.coverUrl
      ? r.tracks.map((t) => ({
          source: "spotify" as const,
          id: r.id,
          title: t.title,
          artists: t.artists,
          duration: t.durationMs !== null ? t.durationMs / 1000 : null,
          artworkUrl: r.coverUrl!,
          pageUrl: r.url,
          album: r.name,
          releaseDate: r.releaseDate,
        }))
      : [],
  )
  return [...apple, ...sc, ...sp]
}

/** Apply a reviewed override to an automatic match. */
const resolve = (
  match: ArtworkMatch,
  override: ArtworkOverride | undefined,
  byKey: ReadonlyMap<string, ArtworkCandidate>,
): { readonly art: ArtworkCandidate | null; readonly decided: "auto" | "override" | "review" | "none" | "keep" } => {
  if (!override) return { art: match.status === "auto" ? match.chosen : null, decided: match.status }
  switch (override.action) {
    case "keep":
      return { art: null, decided: "keep" }
    case "url":
      return {
        art: {
          source: "soundcloud",
          id: `url-${Buffer.from(override.url).toString("base64url").slice(-16)}`,
          title: "",
          artists: [],
          duration: null,
          artworkUrl: override.url,
          pageUrl: override.pageUrl ?? override.url,
          album: null,
          releaseDate: null,
        },
        decided: "override",
      }
    default: {
      const art = byKey.get(`${override.action}:${override.id}`) ?? null
      return { art, decided: art ? "override" : "review" }
    }
  }
}

const SOURCE_PREFIX = { apple: "ap", soundcloud: "sc", spotify: "sp" } as const
const artSourceFile = (art: ArtworkCandidate) => NodePath.join(sourceArtDir, `${SOURCE_PREFIX[art.source]}-${art.id}.img`)

const download = (url: string, file: string) =>
  Effect.tryPromise(async () => {
    if (NodeFs.existsSync(file)) return
    const response = await fetch(url, { headers: { "user-agent": "riot-music-archive/0.1 (personal archive)" } })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    NodeFs.mkdirSync(NodePath.dirname(file), { recursive: true })
    const temp = tempPath(file)
    NodeFs.writeFileSync(temp, bytes)
    commitTemp(temp, file)
  })

const render = (songId: string, source: string) =>
  Effect.tryPromise(async () => {
    const input = NodeFs.readFileSync(source)
    const jpeg = await sharp(input)
      .rotate()
      .resize(COVER_SIZE, COVER_SIZE, { fit: "cover", position: "centre", kernel: "lanczos3" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
    const out = songCoverFile(songId)
    NodeFs.mkdirSync(paths.covers, { recursive: true })
    const temp = tempPath(out)
    NodeFs.writeFileSync(temp, jpeg)
    commitTemp(temp, out)
    const { data, info } = await sharp(jpeg).resize(96, 96, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const palette: PaletteFile = {
      youtubeId: songCoverKey(songId),
      colors: extractPalette({ data, width: info.width, height: info.height, channels: info.channels }),
    }
    writeJson(songPaletteFile(songId), palette)
  })

export interface ArtworkOptions {
  readonly matchOnly: boolean
  readonly force: boolean
  readonly concurrency: number
}

export const artwork = (options: ArtworkOptions) =>
  Effect.gen(function* () {
    const started = Date.now()
    const catalog = Option.getOrNull(yield* readCatalog)
    if (!catalog) return yield* Effect.logWarning("artwork: data/catalog.json not found — run `catalog` first")
    const candidates = loadCandidates()
    const index = indexCandidates(candidates)
    const byKey = new Map(candidates.map((c) => [`${c.source}:${c.id}`, c]))
    const overrides = readOverrides()

    const matches = songsForArtwork(catalog).map((song) => matchSong(song, index))
    const decisions = matches.map((m) => ({ match: m, ...resolve(m, overrides[m.songId], byKey) }))

    NodeFs.mkdirSync(artworkDir, { recursive: true })
    writeJson(matchesFile, {
      generatedAt: new Date().toISOString(),
      sources: {
        apple: candidates.filter((c) => c.source === "apple").length,
        soundcloud: candidates.filter((c) => c.source === "soundcloud").length,
        spotify: candidates.filter((c) => c.source === "spotify").length,
      },
      matches: decisions.map(({ match, art, decided }) => ({
        songId: match.songId,
        status: decided,
        chosen: art ? { source: art.source, id: art.id, title: art.title, album: art.album, artworkUrl: art.artworkUrl, pageUrl: art.pageUrl } : null,
        candidates: match.candidates.map((s) => ({
          source: s.candidate.source,
          id: s.candidate.id,
          title: s.candidate.title,
          artists: s.candidate.artists,
          duration: s.candidate.duration,
          album: s.candidate.album,
          artworkUrl: s.candidate.artworkUrl,
          pageUrl: s.candidate.pageUrl,
          score: Math.round(s.score * 100) / 100,
          reasons: s.reasons,
        })),
      })),
    })
    const tally = (status: string) => decisions.filter((d) => d.decided === status).length
    yield* Effect.logInfo(
      `artwork: ${candidates.length} candidates; ${tally("auto")} auto, ${tally("override")} override, ${tally("review")} need review, ${tally("keep")} keep, ${tally("none")} no match → ${matchesFile}`,
    )
    if (options.matchOnly) return

    // Songs that should NOT carry an artwork cover any more (keep / unresolved) lose a stale one.
    for (const d of decisions) {
      if (d.art) continue
      for (const file of [songCoverFile(d.match.songId), songPaletteFile(d.match.songId)]) if (NodeFs.existsSync(file)) NodeFs.rmSync(file)
    }

    const todo = decisions.filter((d) => d.art !== null)
    const stats = yield* Ref.make({ rendered: 0, upToDate: 0, failed: 0 })
    const tick = progressLogger("artwork", todo.length)
    yield* Effect.forEach(
      todo,
      ({ match, art }) => {
        const source = artSourceFile(art!)
        const out = songCoverFile(match.songId)
        const fresh = !options.force && NodeFs.existsSync(out) && NodeFs.existsSync(source) && NodeFs.statSync(out).mtimeMs >= NodeFs.statSync(source).mtimeMs
        return (fresh
          ? Ref.update(stats, (s) => ({ ...s, upToDate: s.upToDate + 1 }))
          : download(art!.artworkUrl, source).pipe(
              Effect.andThen(render(match.songId, source)),
              Effect.andThen(Ref.update(stats, (s) => ({ ...s, rendered: s.rendered + 1 }))),
            )
        ).pipe(
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`artwork ${match.songId} failed: ${describe(error)}`)),
            ),
          ),
          Effect.andThen(tick()),
        )
      },
      { concurrency: options.concurrency, discard: true },
    )
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(`artwork done in ${seconds(started)}: ${s.rendered} rendered, ${s.upToDate} up to date, ${s.failed} failed`)
  })

export const artworkCommand = Command.make(
  "artwork",
  {
    matchOnly: Flag.Boolean("match-only").pipe(
      Flag.withDescription("Only write data/curated/artwork/matches.json; download nothing"),
      Flag.withDefault(false),
    ),
    force: forceFlag,
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Parallel artwork downloads"), Flag.withDefault(6)),
  },
  (options) => artwork(options),
).pipe(
  Command.withDescription(
    "Match songs to official SoundCloud/Spotify album art → media/covers/song-<id>.jpg (overrides: data/curated/artwork/overrides.json)",
  ),
)
