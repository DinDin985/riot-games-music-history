import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import type { ArtistRole, VideoKind, VideoRole } from "@workspace/db/domain/types"
import { loadTaxonomy, loadVideoClasses, readInfoMeta, readJson, type TaxonomyInput } from "../catalog/inputs.ts"
import { isoDate } from "../catalog/normalize.ts"
import type { Catalog } from "../catalog/types.ts"
import { paths } from "../paths.ts"
import type {
  AssociationEntry,
  Confidence,
  ExtraEntry,
  ResearchEntry,
  SourceRef,
  TimelineTaxonomyFile,
} from "./types.ts"

/**
 * Loading of the `timeline` stage inputs: `data/catalog.json`, the taxonomies,
 * the curated timeline research under `data/curated/timeline/**` and lookups
 * into the local media. Every curated file may be missing, partial or still
 * being written by a researcher: unreadable files and malformed entries are
 * skipped and listed in `problems`, never fatal.
 */

// ---------------------------------------------------------------------------
// Shapes

/** A curated entry plus the file it came from (relative to `data/curated/timeline/`). */
export interface Sourced<A> {
  readonly file: string
  readonly entry: A
}

/**
 * An association entry as loaded. `tags` is null when the file does not give a
 * tag list (the derived tags are kept); `undefined` video/audio ids mean "absent"
 * (keep the catalog's), `null` means "none".
 */
export interface AssociationInput extends Omit<AssociationEntry, "tags"> {
  readonly tags: ReadonlyArray<string> | null
}

/** What the timeline needs from a classified channel video (`data/curated/video-classes/*.json`). */
export interface VideoClassInfo {
  readonly title: string | null
  readonly kind: VideoKind
  readonly role: VideoRole
}

/** The bits of a yt-dlp `media/meta/<id>.info.json` the timeline uses. */
export interface VideoInfo {
  readonly title: string | null
  /** `yyyy-mm-dd`. */
  readonly uploadDate: string | null
  readonly duration: number | null
}

/** Read-only view of the local `media/` folder (an in-memory fake in tests). */
export interface TimelineMedia {
  /** `media/<relative>` exists (forward slashes, e.g. `audio/abc.m4a`). */
  readonly exists: (relative: string) => boolean
  /** Colours of `media/analysis/palette/<key>.json`, null when missing. */
  readonly palette: (key: string) => ReadonlyArray<string> | null
  /** Duration (seconds) from `media/analysis/<youtubeId>.json`, null when not analysed. */
  readonly analysisDuration: (youtubeId: string) => number | null
  /** `media/meta/<youtubeId>.info.json`, null when not downloaded. */
  readonly info: (youtubeId: string) => VideoInfo | null
}

export interface TimelineInputs {
  readonly generatedAt: string
  readonly catalog: Catalog
  /** `data/curated/taxonomy.json` (game + category ids). */
  readonly taxonomy: TaxonomyInput
  /** `data/curated/timeline/taxonomy.json`, null when missing or unreadable. */
  readonly timelineTaxonomy: TimelineTaxonomyFile | null
  readonly research: ReadonlyArray<Sourced<ResearchEntry>>
  readonly extras: ReadonlyArray<Sourced<ExtraEntry>>
  readonly associations: ReadonlyArray<Sourced<AssociationInput>>
  readonly videoClasses: ReadonlyMap<string, VideoClassInfo>
  readonly media: TimelineMedia
  /** Loader problems (unreadable files, malformed entries). */
  readonly problems: ReadonlyArray<string>
  /** Curated files read per folder. */
  readonly files: { readonly research: number; readonly extras: number; readonly associations: number }
}

// ---------------------------------------------------------------------------
// Field helpers

type Json = unknown

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: Json): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null)
const arr = (value: Json): ReadonlyArray<Json> => (Array.isArray(value) ? value : [])
const strings = (value: Json): ReadonlyArray<string> => arr(value).flatMap((v) => (str(v) ? [str(v)!] : []))

const ARTIST_ROLES: ReadonlySet<string> = new Set<ArtistRole>(["primary", "featured", "remixer", "composer"])
const VIDEO_KINDS: ReadonlySet<string> = new Set<VideoKind>([
  "music_video",
  "official_audio",
  "lyric_video",
  "visualizer",
  "cinematic",
  "login_screen",
  "champion_theme",
  "live_performance",
  "remix",
  "animated_short",
  "skin_trailer_song",
  "making_of",
  "soundtrack_compilation",
  "not_music",
])
const CONFIDENCE: ReadonlySet<string> = new Set<Confidence>(["high", "medium", "low"])

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

const httpUrl = (value: Json): string | null => {
  const text = str(value)
  return text && /^https?:\/\//i.test(text) ? text : null
}

const sourcesOf = (value: Json): ReadonlyArray<SourceRef> =>
  arr(value).flatMap((s) => {
    if (typeof s === "string") return httpUrl(s) ? [{ title: s, url: s }] : []
    if (!isRecord(s)) return []
    const url = httpUrl(s.url)
    return url ? [{ title: str(s.title) ?? url, url }] : []
  })

const confidenceOf = (value: Json): Confidence => {
  const text = str(value)?.toLowerCase()
  return text && CONFIDENCE.has(text) ? (text as Confidence) : "medium"
}

const videoKindOf = (value: Json): VideoKind | null => {
  const text = str(value)
  return text && VIDEO_KINDS.has(text) ? (text as VideoKind) : null
}

/**
 * A YouTube id field: valid id → id, explicit null → null, missing → undefined.
 * Invalid values are reported and treated as missing.
 */
const youtubeIdField = (
  record: Record<string, Json>,
  key: string,
  where: string,
  problems: Array<string>,
): string | null | undefined => {
  if (!(key in record) || record[key] === undefined) return undefined
  const value = record[key]
  if (value === null) return null
  const text = str(value)
  if (text && YOUTUBE_ID.test(text)) return text
  problems.push(`${where}: invalid ${key} ${JSON.stringify(value)} (ignored)`)
  return undefined
}

// ---------------------------------------------------------------------------
// Entry normalisers (raw JSON → contract shapes)

export const normalizeResearch = (raw: Json, where: string, problems: Array<string>): ResearchEntry | null => {
  if (!isRecord(raw)) return null
  const songId = str(raw.songId)
  if (!songId) {
    problems.push(`${where}: research entry without songId (skipped)`)
    return null
  }
  const coverUrl = httpUrl(raw.coverUrl)
  if (str(raw.coverUrl) && !coverUrl) problems.push(`${where}: ${songId} coverUrl is not an http(s) URL (ignored)`)
  const notes = str(raw.notes)
  return {
    songId,
    date: str(raw.date),
    usedFor: str(raw.usedFor),
    background: str(raw.background),
    coverUrl,
    spotifyUrl: httpUrl(raw.spotifyUrl),
    sources: sourcesOf(raw.sources),
    confidence: confidenceOf(raw.confidence),
    ...(notes ? { notes } : {}),
  }
}

export const normalizeExtra = (raw: Json, where: string, problems: Array<string>): ExtraEntry | null => {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const title = str(raw.title)
  if (!id || !title) {
    problems.push(`${where}: extra without id or title (skipped)`)
    return null
  }
  const ytId = (key: string) => youtubeIdField(raw, key, `${where} ${id}`, problems) ?? null
  const notes = str(raw.notes)
  return {
    id,
    title,
    artists: arr(raw.artists).flatMap((a) => {
      if (typeof a === "string" && a.trim()) return [{ name: a.trim(), role: "primary" as ArtistRole }]
      if (!isRecord(a) || !str(a.name)) return []
      const role = str(a.role)
      return [{ name: str(a.name)!, role: (role && ARTIST_ROLES.has(role) ? role : "primary") as ArtistRole }]
    }),
    gameId: str(raw.gameId) ?? "",
    categoryIds: strings(raw.categoryIds),
    tags: strings(raw.tags),
    album: str(raw.album),
    date: str(raw.date) ?? "",
    usedFor: str(raw.usedFor),
    background: str(raw.background),
    audioYoutubeId: ytId("audioYoutubeId"),
    musicVideoYoutubeId: ytId("musicVideoYoutubeId"),
    musicVideoKind: videoKindOf(raw.musicVideoKind),
    musicVideoTitle: str(raw.musicVideoTitle),
    spotifyUrl: httpUrl(raw.spotifyUrl),
    coverUrl: httpUrl(raw.coverUrl),
    sources: sourcesOf(raw.sources),
    confidence: confidenceOf(raw.confidence),
    ...(typeof raw.verified === "boolean" ? { verified: raw.verified } : {}),
    ...(notes ? { notes } : {}),
  }
}

export const normalizeAssociation = (raw: Json, where: string, problems: Array<string>): AssociationInput | null => {
  if (!isRecord(raw)) return null
  const songId = str(raw.songId)
  if (!songId) {
    problems.push(`${where}: association without songId (skipped)`)
    return null
  }
  const ytId = (key: string) => youtubeIdField(raw, key, `${where} ${songId}`, problems)
  const musicVideoYoutubeId = ytId("musicVideoYoutubeId")
  const audioYoutubeId = ytId("audioYoutubeId")
  const musicVideoKind = videoKindOf(raw.musicVideoKind)
  const notes = str(raw.notes)
  return {
    songId,
    gameId: str(raw.gameId),
    tags: Array.isArray(raw.tags) ? strings(raw.tags) : null,
    ...(musicVideoYoutubeId !== undefined ? { musicVideoYoutubeId } : {}),
    ...(musicVideoKind ? { musicVideoKind } : {}),
    ...(audioYoutubeId !== undefined ? { audioYoutubeId } : {}),
    ...(notes ? { notes } : {}),
  }
}

const TAG_KINDS = new Set(["event", "group", "format", "series"])
const DISC_KINDS = new Set(["all", "game", "collection"])
const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i

export const normalizeTimelineTaxonomy = (raw: Json, problems: Array<string>): TimelineTaxonomyFile | null => {
  if (!isRecord(raw)) return null
  const color = (value: Json) => (str(value) && HEX.test(str(value)!) ? str(value)! : "#888888")
  const tags = arr(raw.tags).flatMap((t, i) => {
    const id = isRecord(t) ? str(t.id) : null
    if (!isRecord(t) || !id) {
      problems.push(`taxonomy.json tags[${i}]: tag without id (skipped)`)
      return []
    }
    const kind = str(t.kind)
    if (!kind || !TAG_KINDS.has(kind))
      problems.push(`taxonomy.json tag ${id}: unknown kind ${JSON.stringify(t.kind)} (using "format")`)
    return [
      {
        id,
        name: str(t.name) ?? id,
        kind: (kind && TAG_KINDS.has(kind) ? kind : "format") as TimelineTaxonomyFile["tags"][number]["kind"],
        color: color(t.color),
        description: str(t.description) ?? "",
      },
    ]
  })
  const discs = arr(raw.discs).flatMap((d, i) => {
    const id = isRecord(d) ? str(d.id) : null
    const kind = isRecord(d) ? str(d.kind) : null
    if (!isRecord(d) || !id || !kind || !DISC_KINDS.has(kind)) {
      problems.push(`taxonomy.json discs[${i}]: disc without id or with unknown kind (skipped)`)
      return []
    }
    return [
      {
        id,
        name: str(d.name) ?? id,
        short: (str(d.short) ?? id).slice(0, 10),
        kind: kind as TimelineTaxonomyFile["discs"][number]["kind"],
        color: color(d.color),
        description: str(d.description) ?? "",
        gameIds: strings(d.gameIds),
        tags: strings(d.tags),
      },
    ]
  })
  return { tags, discs }
}

// ---------------------------------------------------------------------------
// Curated files

export const timelineDir = NodePath.join(paths.curated, "timeline")

/** Every `*.json` under `dir` (recursive, dotfiles skipped), as paths relative to `base`, sorted. */
const listJsonFiles = (dir: string, base: string): ReadonlyArray<string> => {
  let names: ReadonlyArray<NodeFs.Dirent> = []
  try {
    names = NodeFs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<string> = []
  for (const dirent of names) {
    if (dirent.name.startsWith(".")) continue
    const full = NodePath.join(dir, dirent.name)
    if (dirent.isDirectory()) out.push(...listJsonFiles(full, base))
    else if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".json"))
      out.push(NodePath.relative(base, full).replace(/\\/g, "/"))
  }
  return out.sort()
}

/** Read one curated folder: `{ entries: [...] }` or a bare array per file. */
const loadFolder = <A>(
  root: string,
  folder: string,
  normalize: (raw: Json, where: string, problems: Array<string>) => A | null,
  problems: Array<string>,
): { readonly items: ReadonlyArray<Sourced<A>>; readonly files: number } => {
  const files = listJsonFiles(NodePath.join(root, folder), root)
  const items: Array<Sourced<A>> = []
  for (const file of files) {
    const json = readJson(NodePath.join(root, file))
    const entries = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.entries) ? json.entries : null
    if (entries === null) {
      problems.push(`${file}: unreadable or without an "entries" array (skipped)`)
      continue
    }
    entries.forEach((raw, index) => {
      const entry = normalize(raw, `${file}#${index}`, problems)
      if (entry) items.push({ file, entry })
    })
  }
  return { items, files: files.length }
}

export interface CuratedTimeline {
  readonly timelineTaxonomy: TimelineTaxonomyFile | null
  readonly research: ReadonlyArray<Sourced<ResearchEntry>>
  readonly extras: ReadonlyArray<Sourced<ExtraEntry>>
  readonly associations: ReadonlyArray<Sourced<AssociationInput>>
  readonly problems: ReadonlyArray<string>
  readonly files: TimelineInputs["files"]
}

/** Everything under `data/curated/timeline/` (or `root`, for tests). */
export const loadCuratedTimeline = (root: string = timelineDir): CuratedTimeline => {
  const problems: Array<string> = []
  const taxonomyJson = readJson(NodePath.join(root, "taxonomy.json"))
  const timelineTaxonomy = normalizeTimelineTaxonomy(taxonomyJson, problems)
  if (!timelineTaxonomy)
    problems.push("taxonomy.json: missing or unreadable (using the taxonomy categories and one 'all' disc)")
  const research = loadFolder(root, "research", normalizeResearch, problems)
  const extras = loadFolder(root, "extras", normalizeExtra, problems)
  const associations = loadFolder(root, "associations", normalizeAssociation, problems)
  return {
    timelineTaxonomy,
    research: research.items,
    extras: extras.items,
    associations: associations.items,
    problems,
    files: { research: research.files, extras: extras.files, associations: associations.files },
  }
}

// ---------------------------------------------------------------------------
// Media

/** `TimelineMedia` over the real `media/` folder. Directory listings and reads are memoised per instance. */
export const fsMedia = (mediaRoot: string = paths.media): TimelineMedia => {
  const listings = new Map<string, ReadonlySet<string>>()
  const listing = (dir: string): ReadonlySet<string> => {
    let found = listings.get(dir)
    if (!found) {
      try {
        found = new Set(NodeFs.readdirSync(NodePath.join(mediaRoot, dir)).filter((name) => !name.includes(".tmp")))
      } catch {
        found = new Set()
      }
      listings.set(dir, found)
    }
    return found
  }
  // Set lookups are case-sensitive, unlike Windows' existsSync: YouTube ids differ by case.
  const exists = (relative: string): boolean => {
    const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "")
    const slash = normalized.lastIndexOf("/")
    return listing(slash < 0 ? "" : normalized.slice(0, slash)).has(normalized.slice(slash + 1))
  }
  const palettes = new Map<string, ReadonlyArray<string> | null>()
  const durations = new Map<string, number | null>()
  const infos = new Map<string, VideoInfo | null>()
  const memo = <A>(cache: Map<string, A>, key: string, compute: () => A): A => {
    if (!cache.has(key)) cache.set(key, compute())
    return cache.get(key) as A
  }
  return {
    exists,
    palette: (key) =>
      memo(palettes, key, () => {
        if (!exists(`analysis/palette/${key}.json`)) return null
        const json = readJson(NodePath.join(mediaRoot, "analysis", "palette", `${key}.json`))
        const colors = isRecord(json) ? strings(json.colors) : []
        return colors.length > 0 ? colors : null
      }),
    analysisDuration: (youtubeId) =>
      memo(durations, youtubeId, () => {
        if (!exists(`analysis/${youtubeId}.json`)) return null
        const json = readJson(NodePath.join(mediaRoot, "analysis", `${youtubeId}.json`))
        const duration = isRecord(json) ? json.duration : null
        return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null
      }),
    info: (youtubeId) =>
      memo(infos, youtubeId, () => {
        if (!exists(`meta/${youtubeId}.info.json`)) return null
        const meta = readInfoMeta(youtubeId)
        if (!meta) return null
        return {
          title: meta.title ?? null,
          uploadDate: isoDate(meta.upload_date ?? null),
          duration: typeof meta.duration === "number" && meta.duration > 0 ? meta.duration : null,
        }
      }),
  }
}

/** Classified channel videos by id (first classification wins, like the catalog). */
export const loadVideoClassInfo = (): ReadonlyMap<string, VideoClassInfo> =>
  new Map(loadVideoClasses().map((v) => [v.id, { title: v.title.trim() || null, kind: v.kind, role: v.role }]))

// ---------------------------------------------------------------------------
// Everything

/** Read every input of the `timeline` stage. Throws only when the catalog or the game taxonomy is missing. */
export const loadTimelineInputs = (
  catalogFile: string,
  generatedAt: string = new Date().toISOString(),
): TimelineInputs => {
  const json = readJson(catalogFile)
  if (!isRecord(json) || !Array.isArray(json.songs) || !Array.isArray(json.artists)) {
    throw new Error(
      `${NodePath.relative(paths.root, catalogFile)} is missing or invalid — run \`npm run pipeline -- catalog\` first`,
    )
  }
  const curated = loadCuratedTimeline()
  return {
    generatedAt,
    catalog: json as unknown as Catalog,
    taxonomy: loadTaxonomy(),
    timelineTaxonomy: curated.timelineTaxonomy,
    research: curated.research,
    extras: curated.extras,
    associations: curated.associations,
    videoClasses: loadVideoClassInfo(),
    media: fsMedia(),
    problems: curated.problems,
    files: curated.files,
  }
}
