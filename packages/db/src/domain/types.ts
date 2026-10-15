/**
 * Domain types shared by the pipeline, the Next.js app and the Astro pages.
 * Pure types only — safe to import anywhere (server, client, Astro islands).
 */

export type ArtistRole = "primary" | "featured" | "remixer" | "composer"
export type ArtistKind = "artist" | "band" | "virtual-group" | "composer" | "orchestra"
export type AudioKind = "topic" | "official_audio" | "music_video"
export type VideoKind =
  | "music_video"
  | "official_audio"
  | "lyric_video"
  | "visualizer"
  | "cinematic"
  | "login_screen"
  | "champion_theme"
  | "live_performance"
  | "remix"
  | "animated_short"
  | "skin_trailer_song"
  | "making_of"
  | "soundtrack_compilation"
  | "not_music"
export type VideoRole = "primary_mv" | "audio_source" | "related" | "skip"

export interface Game {
  readonly id: string
  readonly name: string
  readonly short: string
  readonly color: string
  readonly songCount: number
}

export interface Category {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly songCount: number
}

export interface ArtistRef {
  readonly id: string
  readonly name: string
  readonly role: ArtistRole
}

/** Everything a song card / list row needs. */
export interface SongSummary {
  readonly id: string
  readonly title: string
  /** Pre-formatted credit line, e.g. "K/DA ft. Madison Beer, (G)I-DLE, Jaira Burns". */
  readonly displayArtist: string
  readonly gameId: string
  readonly primaryCategoryId: string
  readonly categoryIds: ReadonlyArray<string>
  readonly year: number | null
  readonly duration: number | null
  readonly viewCount: number | null
  readonly isImpact: boolean
  readonly hasAudio: boolean
  readonly hasVideo: boolean
  /** `/media/...` URLs (null when the asset is missing). */
  readonly audioUrl: string | null
  readonly coverUrl: string | null
  /**
   * The picture the cover shows: songs whose covers are the same picture (one
   * album's tracks, re-uploads of the same art) share it. Built by the
   * pipeline; absent where a summary is not read from the database.
   */
  readonly coverKey?: string | null
  readonly gifUrl: string | null
  /** Album-cover colours, dominant first (hex). Used for the fallback backdrop. */
  readonly palette: ReadonlyArray<string>
}

export interface VideoRef {
  readonly id: string
  readonly title: string
  readonly kind: VideoKind
  readonly role: VideoRole
  readonly duration: number | null
  readonly uploadDate: string | null
  readonly viewCount: number | null
  /** Local MP4 (`/media/video/<id>.mp4`) when downloaded. */
  readonly videoUrl: string | null
  readonly youtubeUrl: string
  readonly thumbnailUrl: string
}

export interface SongDetail extends SongSummary {
  readonly album: string | null
  readonly releaseDate: string | null
  readonly description: string | null
  readonly audioKind: AudioKind | null
  readonly audioVideoId: string | null
  readonly artists: ReadonlyArray<ArtistRef>
  /** The video used by the "Watch music video" popup (null when none). */
  readonly musicVideo: VideoRef | null
  /** Every other linked video (live performances, remixes, making-ofs…). */
  readonly videos: ReadonlyArray<VideoRef>
  readonly bpm: number | null
  readonly hasAlignment: boolean
}

export interface SongAnalysis {
  readonly songId: string
  readonly bpm: number | null
  readonly bpmConfidence: number | null
  /** Beat times in seconds (RhythmExtractor2013 ticks). */
  readonly beats: ReadonlyArray<number>
  /** Base64 Uint8Array loudness envelope (0–255) sampled at `peaksRate` Hz. */
  readonly peaks: string
  readonly peaksRate: number
  readonly chorusStart: number | null
  readonly chorusEnd: number | null
}

export interface ArtistSummary {
  readonly id: string
  readonly name: string
  readonly kind: ArtistKind
  readonly songCount: number
  readonly gameIds: ReadonlyArray<string>
  /** Cover / palette of the artist's most popular song, for the card. */
  readonly coverUrl: string | null
  readonly palette: ReadonlyArray<string>
}

export interface ArtistDetail extends ArtistSummary {
  readonly bio: string | null
  readonly imageUrl: string | null
  readonly songs: ReadonlyArray<SongSummary & { readonly role: ArtistRole }>
}

export interface Award {
  readonly id: string
  readonly year: number
  readonly ceremony: string
  readonly organization: string
  readonly award: string
  readonly result: "won" | "nominated"
  readonly recipient: string
  readonly project: string
  readonly gameId: string | null
  readonly musicRelated: boolean
  readonly songTitle: string | null
  readonly songId: string | null
  readonly sourceUrls: ReadonlyArray<string>
  readonly notes: string | null
}

export interface ImpactStory {
  readonly slug: string
  readonly rank: number
  readonly song: string
  readonly songId: string | null
  readonly artists: ReadonlyArray<string>
  readonly year: number
  readonly game: string
  readonly categories: ReadonlyArray<string>
  readonly tagline: string
  readonly headline: string
  readonly summary: string
  readonly story: ReadonlyArray<{ readonly heading: string; readonly body: string }>
  readonly whyItMatters: ReadonlyArray<string>
  readonly communityMoments: ReadonlyArray<{
    readonly title: string
    readonly description: string
    readonly date: string | null
    readonly sourceUrl: string | null
  }>
  readonly stats: ReadonlyArray<{
    readonly label: string
    readonly value: string
    readonly raw: number | null
    readonly asOf: string
    readonly sourceUrl: string | null
  }>
  readonly videos: ReadonlyArray<{ readonly youtubeId: string; readonly title: string; readonly kind: string; readonly role: string }>
  readonly keyMoments: ReadonlyArray<{
    readonly youtubeId: string
    readonly t: number
    readonly label: string
    readonly description: string
  }>
  readonly featuredClip: {
    readonly youtubeId: string
    readonly start: number
    readonly end: number
    readonly description: string
    /** `/media/clips/<slug>.mp4|gif` when the pipeline rendered it. */
    readonly clipUrl?: string | null
    readonly gifUrl?: string | null
  } | null
  readonly sources: ReadonlyArray<{ readonly title: string; readonly url: string; readonly publisher: string }>
}

export type SongSort = "popular" | "newest" | "oldest" | "title"

export interface SongFilter {
  readonly q?: string | undefined
  readonly game?: string | undefined
  readonly category?: string | undefined
  readonly artist?: string | undefined
  readonly year?: number | undefined
  readonly hasVideo?: boolean | undefined
  readonly sort?: SongSort | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

export interface Page<A> {
  readonly items: ReadonlyArray<A>
  readonly total: number
}

export interface ArchiveStats {
  readonly songs: number
  readonly artists: number
  readonly musicVideos: number
  readonly hours: number
  readonly awardsWon: number
  readonly firstYear: number | null
  readonly lastYear: number | null
}
