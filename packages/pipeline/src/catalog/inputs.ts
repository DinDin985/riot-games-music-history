import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import type { ArtistRole, VideoKind, VideoRole } from "@workspace/db/domain/types"
import { infoFile, paths } from "../paths.ts"
import { readListing, sources } from "../sources.ts"

/**
 * Loading of every catalog input from disk. Each loader tolerates missing or
 * partial files (the curated research is still growing), so the catalog stage
 * can be re-run at any time.
 */

// ---------------------------------------------------------------------------
// Shapes

/** The subset of a yt-dlp `.info.json` the catalog uses. */
export interface InfoMeta {
  readonly title?: string | undefined
  readonly track?: string | undefined
  readonly artists?: ReadonlyArray<string> | undefined
  readonly album?: string | undefined
  readonly release_date?: string | undefined
  readonly release_year?: number | undefined
  readonly upload_date?: string | undefined
  readonly view_count?: number | undefined
  readonly duration?: number | undefined
  readonly description?: string | undefined
}

export interface TopicTrackInput {
  readonly id: string
  /** data/sources key: topic_lol | topic_valorant | topic_2xko */
  readonly source: string
  readonly tsvTitle: string
  readonly tsvDuration: number | null
  readonly meta: InfoMeta | null
  readonly audioExists: boolean
}

export interface VideoClassInput {
  readonly id: string
  readonly source: string
  readonly title: string
  readonly durationSeconds: number | null
  readonly kind: VideoKind
  readonly role: VideoRole
  readonly song: string | null
  readonly artists: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>
  readonly game: string | null
  readonly categories: ReadonlyArray<string>
  readonly year: number | null
  readonly topicTrackId: string | null
  readonly mvRank: number | null
}

export interface WikiSongInput {
  readonly title: string
  readonly artists: ReadonlyArray<{ readonly name: string; readonly role: string }>
  readonly year: number | null
  readonly game: string | null
  readonly categories: ReadonlyArray<string>
  readonly champions: ReadonlyArray<string>
  readonly album: string | null
  readonly youtubeIds: ReadonlyArray<string>
}

export interface WikiAlbumInput {
  readonly title: string
  readonly game: string | null
  readonly year: number | null
}

export interface SpotifyTrackInput {
  readonly title: string
  readonly artists: ReadonlyArray<string>
  readonly releaseDate: string | null
  readonly releaseName: string
  readonly releaseType: string
}

/** What the catalog needs from `data/curated/impact/<slug>.json`. */
export interface ImpactInput {
  readonly slug: string
  readonly song: string
  readonly artists: ReadonlyArray<string>
  readonly year: number | null
  readonly videos: ReadonlyArray<{ readonly youtubeId: string; readonly role: string }>
}

export interface TaxonomyInput {
  /** `hidden` games stay valid ids (awards, labels) but are left out of the site's game lists. */
  readonly games: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly short: string
    readonly color: string
    readonly hidden?: boolean
  }>
  readonly categories: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string }>
}

export interface CatalogInputs {
  readonly taxonomy: TaxonomyInput
  readonly topicTracks: ReadonlyArray<TopicTrackInput>
  readonly videoClasses: ReadonlyArray<VideoClassInput>
  /** yt-dlp metadata of channel videos, keyed by YouTube id (missing when not downloaded). */
  readonly videoMeta: ReadonlyMap<string, InfoMeta>
  readonly wikiSongs: ReadonlyArray<WikiSongInput>
  readonly wikiAlbums: ReadonlyArray<WikiAlbumInput>
  readonly spotifyTracks: ReadonlyArray<SpotifyTrackInput>
  readonly impact: ReadonlyArray<ImpactInput>
}

// ---------------------------------------------------------------------------
// Helpers

type Json = unknown

export const readJson = (file: string): Json | null => {
  try {
    return JSON.parse(NodeFs.readFileSync(file, "utf8").replace(/^﻿/, "")) as Json
  } catch {
    return null
  }
}

const listJson = (dir: string): ReadonlyArray<string> => {
  try {
    return NodeFs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort()
      .map((f) => NodePath.join(dir, f))
  } catch {
    return []
  }
}

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: Json): string | null => (typeof value === "string" && value.trim().length > 0 ? value : null)
const num = (value: Json): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
const arr = (value: Json): ReadonlyArray<Json> => (Array.isArray(value) ? value : [])

/** Read only the fields we need from a (large) yt-dlp info json. */
export const readInfoMeta = (youtubeId: string): InfoMeta | null => {
  const json = readJson(infoFile(youtubeId))
  if (!isRecord(json)) return null
  return {
    title: str(json.title) ?? undefined,
    track: str(json.track) ?? undefined,
    artists: arr(json.artists).flatMap((a) => (typeof a === "string" ? [a] : [])),
    album: str(json.album) ?? undefined,
    release_date: str(json.release_date) ?? undefined,
    release_year: num(json.release_year) ?? undefined,
    upload_date: str(json.upload_date) ?? undefined,
    view_count: num(json.view_count) ?? undefined,
    duration: num(json.duration) ?? undefined,
    description: str(json.description) ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Loaders

export const loadTaxonomy = (): TaxonomyInput => {
  const json = readJson(NodePath.join(paths.curated, "taxonomy.json"))
  if (!isRecord(json)) throw new Error("data/curated/taxonomy.json is missing or invalid")
  return {
    games: arr(json.games).flatMap((g) =>
      isRecord(g) && str(g.id)
        ? [
            {
              id: str(g.id)!,
              name: str(g.name) ?? str(g.id)!,
              short: str(g.short) ?? str(g.id)!,
              color: str(g.color) ?? "#888888",
              hidden: g.hidden === true,
            },
          ]
        : [],
    ),
    categories: arr(json.categories).flatMap((c) =>
      isRecord(c) && str(c.id)
        ? [{ id: str(c.id)!, name: str(c.name) ?? str(c.id)!, description: str(c.description) ?? "" }]
        : [],
    ),
  }
}

export const loadTopicTracks = (): ReadonlyArray<TopicTrackInput> =>
  sources
    .filter((s) => s.kind === "topic")
    .flatMap((source) =>
      readListing(source.key).map((entry) => ({
        id: entry.id,
        source: source.key,
        tsvTitle: entry.title,
        tsvDuration: entry.durationSeconds,
        meta: readInfoMeta(entry.id),
        audioExists: NodeFs.existsSync(NodePath.join(paths.audio, `${entry.id}.m4a`)),
      })),
    )

const VIDEO_ROLES = new Set(["primary_mv", "audio_source", "related", "skip"])

export const loadVideoClasses = (): ReadonlyArray<VideoClassInput> => {
  const seen = new Map<string, VideoClassInput>()
  for (const file of listJson(NodePath.join(paths.curated, "video-classes"))) {
    const json = readJson(file)
    const items = Array.isArray(json) ? json : isRecord(json) ? arr(json.videos ?? json.items) : []
    for (const item of items) {
      if (!isRecord(item) || !str(item.id)) continue
      const role = str(item.role) ?? "skip"
      const entry: VideoClassInput = {
        id: str(item.id)!,
        source: str(item.source) ?? NodePath.basename(file).replace(/-\d+\.json$/i, "").replace(/\.json$/i, ""),
        title: str(item.title) ?? "",
        durationSeconds: num(item.durationSeconds),
        kind: (str(item.kind) ?? "not_music") as VideoKind,
        role: (VIDEO_ROLES.has(role) ? role : "skip") as VideoRole,
        song: str(item.song),
        artists: arr(item.artists).flatMap((a) =>
          isRecord(a) && str(a.name) ? [{ name: str(a.name)!.trim(), role: (str(a.role) ?? "primary") as ArtistRole }] : [],
        ),
        game: str(item.game),
        categories: arr(item.categories).flatMap((c) => (typeof c === "string" ? [c] : [])),
        year: num(item.year),
        topicTrackId: str(item.topicTrackId),
        mvRank: num(item.mvRank),
      }
      // Later files never override an earlier classification of the same id.
      if (!seen.has(entry.id)) seen.set(entry.id, entry)
    }
  }
  return [...seen.values()]
}

export const loadVideoMeta = (ids: Iterable<string>): ReadonlyMap<string, InfoMeta> => {
  const out = new Map<string, InfoMeta>()
  for (const id of ids) {
    const meta = readInfoMeta(id)
    if (meta) out.set(id, meta)
  }
  return out
}

export const loadWiki = (): { songs: ReadonlyArray<WikiSongInput>; albums: ReadonlyArray<WikiAlbumInput> } => {
  const json = readJson(NodePath.join(paths.curated, "wiki-music.json"))
  if (!isRecord(json)) return { songs: [], albums: [] }
  return {
    songs: arr(json.songs).flatMap((s) =>
      isRecord(s) && str(s.title)
        ? [
            {
              title: str(s.title)!,
              artists: arr(s.artists).flatMap((a) =>
                isRecord(a) && str(a.name) ? [{ name: str(a.name)!, role: str(a.role) ?? "primary" }] : [],
              ),
              year: num(s.year),
              game: str(s.game),
              categories: arr(s.categories).flatMap((c) => (typeof c === "string" ? [c] : [])),
              champions: arr(s.champions).flatMap((c) => (typeof c === "string" ? [c] : [])),
              album: str(s.album),
              youtubeIds: arr(s.youtubeIds).flatMap((c) => (typeof c === "string" ? [c] : [])),
            },
          ]
        : [],
    ),
    albums: arr(json.albums).flatMap((a) =>
      isRecord(a) && str(a.title) ? [{ title: str(a.title)!, game: str(a.game), year: num(a.year) }] : [],
    ),
  }
}

export const loadSpotify = (): ReadonlyArray<SpotifyTrackInput> => {
  const json = readJson(NodePath.join(paths.curated, "spotify.json"))
  if (!isRecord(json)) return []
  return arr(json.releases).flatMap((r) => {
    if (!isRecord(r)) return []
    const releaseName = str(r.name) ?? ""
    const releaseType = str(r.type) ?? "single"
    const releaseDate = str(r.releaseDate)
    return arr(r.tracks).flatMap((t) =>
      isRecord(t) && str(t.title)
        ? [
            {
              title: str(t.title)!,
              artists: arr(t.artists).flatMap((a) => (typeof a === "string" ? [a] : [])),
              releaseDate,
              releaseName,
              releaseType,
            },
          ]
        : [],
    )
  })
}

/** Every `data/curated/impact/*.json` story (raw JSON + slug), sorted by file name. */
export const loadImpactFiles = (): ReadonlyArray<{ readonly file: string; readonly json: Record<string, Json> }> =>
  listJson(NodePath.join(paths.curated, "impact")).flatMap((file) => {
    const json = readJson(file)
    if (!isRecord(json)) return []
    const slug = str(json.slug) ?? NodePath.basename(file, ".json")
    return [{ file, json: { ...json, slug } }]
  })

export const loadImpact = (): ReadonlyArray<ImpactInput> =>
  loadImpactFiles().flatMap(({ json }) =>
    str(json.song)
      ? [
          {
            slug: str(json.slug)!,
            song: str(json.song)!,
            artists: arr(json.artists).flatMap((a) => (typeof a === "string" ? [a] : [])),
            year: num(json.year),
            videos: arr(json.videos).flatMap((v) =>
              isRecord(v) && str(v.youtubeId) ? [{ youtubeId: str(v.youtubeId)!, role: str(v.role) ?? "related" }] : [],
            ),
          },
        ]
      : [],
  )

/** Read every input the catalog needs. Synchronous file IO; the stage wraps it in an Effect. */
export const loadCatalogInputs = (): CatalogInputs => {
  const videoClasses = loadVideoClasses()
  const wiki = loadWiki()
  return {
    taxonomy: loadTaxonomy(),
    topicTracks: loadTopicTracks(),
    videoClasses,
    videoMeta: loadVideoMeta(videoClasses.filter((v) => v.role !== "skip").map((v) => v.id)),
    wikiSongs: wiki.songs,
    wikiAlbums: wiki.albums,
    spotifyTracks: loadSpotify(),
    impact: loadImpact(),
  }
}
