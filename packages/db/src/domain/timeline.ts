/**
 * The `/timeline` view: every Riot Games song in release order, grouped onto
 * "vinyls" (one per game, plus collections such as Worlds anthems or K/DA).
 *
 * `npm run pipeline -- timeline` merges `data/catalog.json` with the curated
 * timeline research (`data/curated/timeline/*`) and the local media into
 * `data/timeline.json` (a git-ignored build artefact, like the database).
 * Pure types and helpers only — safe to import on the server and the client.
 */

import type { ArtistRole, SongSummary, VideoKind } from "./types.ts"

/** How much of `TimelineEntry.date` is known. Imprecise dates are padded (`2014-01-01`). */
export type TimelineDatePrecision = "day" | "month" | "year"

/**
 * - `game`: the game / franchise a song belongs to (same ids as the taxonomy games)
 * - `event`: esports events and seasonal moments (Worlds, MSI, VCT…)
 * - `group`: Riot's virtual bands (K/DA, True Damage, Pentakill, HEARTSTEEL…)
 * - `format`: what the music is (cinematic, champion theme, login screen…)
 * - `series`: recurring album series and skin universes (Sessions, Star Guardian…)
 */
export type TimelineTagKind = "event" | "group" | "format" | "series"

export interface TimelineTag {
  readonly id: string
  readonly name: string
  readonly kind: TimelineTagKind
  readonly description: string
  /** Accent colour for chips and the vinyl label (hex). */
  readonly color: string
}

/**
 * - `all`: every entry
 * - `game`: entries whose `gameId` is in `gameIds`
 * - `collection`: entries carrying any of `tags` (or, if set, in `gameIds`)
 */
export type TimelineDiscKind = "all" | "game" | "collection"

/** A vinyl the user can put on the turntable. */
export interface TimelineDisc {
  readonly id: string
  readonly name: string
  /** Short label printed on the record (≤ 10 chars), e.g. "LoL", "K/DA". */
  readonly short: string
  readonly kind: TimelineDiscKind
  readonly description: string
  /** Centre-label colour (hex). */
  readonly color: string
  readonly gameIds: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  /** Computed by the pipeline. */
  readonly entryCount: number
  readonly firstYear: number | null
  readonly lastYear: number | null
}

export interface TimelineArtist {
  readonly name: string
  readonly role: ArtistRole
  /** Artist page id when the artist is in the archive. */
  readonly id: string | null
}

export interface TimelineVideo {
  readonly youtubeId: string
  readonly title: string
  readonly kind: VideoKind
  /** Local MP4 (`/media/video/<id>.mp4`) when downloaded, else null (embed YouTube). */
  readonly videoUrl: string | null
  readonly youtubeUrl: string
  readonly thumbnailUrl: string
}

export interface TimelineSource {
  readonly title: string
  readonly url: string
}

/** The slim record sent to the vinyl for every song (thousands of them). */
export interface TimelineEntry {
  /** Catalog song id, or `x-<slug>` for songs found by the timeline research but not (yet) in the archive. */
  readonly id: string
  /** True when the song has a row in the archive database (`/api/songs/<id>` works). */
  readonly inArchive: boolean
  readonly title: string
  /** Pre-formatted credit line, e.g. "K/DA ft. Madison Beer, (G)I-DLE, Jaira Burns". */
  readonly displayArtist: string
  readonly gameId: string
  /** Taxonomy category ids (a subset of `tags`). */
  readonly categoryIds: ReadonlyArray<string>
  readonly primaryCategoryId: string
  /** Timeline tag ids: taxonomy categories plus groups, events, series. */
  readonly tags: ReadonlyArray<string>
  /** ISO `yyyy-mm-dd`; padded to the 1st of the month / January 1st when imprecise. Sort key. */
  readonly date: string
  readonly datePrecision: TimelineDatePrecision
  readonly year: number
  /** 1–12. */
  readonly month: number
  /** Short "what it was for" label, e.g. "Worlds 2014 anthem". */
  readonly usedFor: string | null
  /** Square album cover: a `/media/...` URL when local, else a remote image (Spotify / YouTube). */
  readonly coverUrl: string | null
  /** Album-cover colours, dominant first (hex). */
  readonly palette: ReadonlyArray<string>
  /** Playable local audio (`/media/audio/<id>.m4a`), null when not downloaded. */
  readonly audioUrl: string | null
  readonly duration: number | null
  /** Has a music video (local MP4 or YouTube). */
  readonly hasVideo: boolean
  readonly viewCount: number | null
  readonly isImpact: boolean
}

/** Everything the detail panel shows for one entry (`/api/timeline/<id>`). */
export interface TimelineEntryDetail extends TimelineEntry {
  readonly album: string | null
  /** YouTube upload date (`yyyy-mm-dd`) of the music video, else of the official audio. */
  readonly uploadDate: string | null
  readonly artists: ReadonlyArray<TimelineArtist>
  /** 1–4 sentences: what the song is and what it was made / used for. */
  readonly background: string | null
  /** The music video (or cinematic / login screen / visualizer) for the song. */
  readonly musicVideo: TimelineVideo | null
  /** Other linked videos (live performances, remixes, making-ofs). */
  readonly videos: ReadonlyArray<TimelineVideo>
  /** Where to listen when there is no local audio (YouTube / Spotify). */
  readonly listenUrl: string | null
  readonly sources: ReadonlyArray<TimelineSource>
}

/** `data/timeline.json`. Entries are sorted by `date`, then title. */
export interface TimelineData {
  readonly generatedAt: string
  readonly entries: ReadonlyArray<TimelineEntryDetail>
  readonly discs: ReadonlyArray<TimelineDisc>
  readonly tags: ReadonlyArray<TimelineTag>
}

/** The client payload for the page: details are fetched on demand. */
export interface TimelinePayload {
  readonly generatedAt: string
  readonly entries: ReadonlyArray<TimelineEntry>
  readonly discs: ReadonlyArray<TimelineDisc>
  readonly tags: ReadonlyArray<TimelineTag>
}

const SLIM_KEYS = [
  "id",
  "inArchive",
  "title",
  "displayArtist",
  "gameId",
  "categoryIds",
  "primaryCategoryId",
  "tags",
  "date",
  "datePrecision",
  "year",
  "month",
  "usedFor",
  "coverUrl",
  "palette",
  "audioUrl",
  "duration",
  "hasVideo",
  "viewCount",
  "isImpact",
] as const satisfies ReadonlyArray<keyof TimelineEntry>

/** Drop the detail-only fields. */
export const toTimelineEntry = (detail: TimelineEntryDetail): TimelineEntry => {
  const out: Record<string, unknown> = {}
  for (const key of SLIM_KEYS) out[key] = detail[key]
  return out as unknown as TimelineEntry
}

/** Does `entry` belong on `disc`? */
export const isOnDisc = (entry: Pick<TimelineEntry, "gameId" | "tags">, disc: TimelineDisc): boolean => {
  switch (disc.kind) {
    case "all":
      return true
    case "game":
      return disc.gameIds.includes(entry.gameId)
    case "collection":
      return disc.gameIds.includes(entry.gameId) || entry.tags.some((t) => disc.tags.includes(t))
  }
}

/** A `SongSummary` for the global player (`usePlayer().play(...)`). */
export const timelineEntryToSong = (entry: TimelineEntry): SongSummary => ({
  id: entry.id,
  title: entry.title,
  displayArtist: entry.displayArtist,
  gameId: entry.gameId,
  primaryCategoryId: entry.primaryCategoryId,
  categoryIds: entry.categoryIds,
  year: entry.year,
  duration: entry.duration,
  viewCount: entry.viewCount,
  isImpact: entry.isImpact,
  hasAudio: entry.audioUrl !== null,
  // The global music-video dialog loads `/api/songs/<id>`, which only archive songs have.
  hasVideo: entry.inArchive && entry.hasVideo,
  audioUrl: entry.audioUrl,
  coverUrl: entry.coverUrl,
  gifUrl: null,
  palette: entry.palette,
})
