import type { ArtistKind, ArtistRole, AudioKind, VideoKind, VideoRole } from "@workspace/db/domain/types"

/**
 * `data/catalog.json` — the canonical, de-duplicated song catalogue produced by
 * `npm run pipeline -- catalog` and consumed by `analyze`, `align`, `gifs` and
 * `build-db`. Committed to git (it is small and reviewable).
 */
export interface Catalog {
  readonly generatedAt: string
  readonly songs: ReadonlyArray<CatalogSong>
  readonly artists: ReadonlyArray<CatalogArtist>
}

export interface CatalogArtist {
  /** kebab-case slug, unique. */
  readonly id: string
  readonly name: string
  readonly kind: ArtistKind
}

export interface CatalogVideo {
  readonly youtubeId: string
  /** data/sources key, e.g. `lol_videos`. */
  readonly source: string
  readonly title: string
  readonly kind: VideoKind
  readonly role: VideoRole
  readonly durationSeconds: number | null
  readonly uploadDate: string | null
  readonly viewCount: number | null
}

export interface CatalogSong {
  /** kebab-case slug, unique (title, plus version/artist suffix on collisions). */
  readonly id: string
  readonly title: string
  readonly displayArtist: string
  readonly artists: ReadonlyArray<{ readonly id: string; readonly role: ArtistRole }>
  /** taxonomy game id */
  readonly gameId: string
  /** taxonomy category id; also present in categoryIds */
  readonly primaryCategoryId: string
  readonly categoryIds: ReadonlyArray<string>
  readonly album: string | null
  readonly year: number | null
  readonly releaseDate: string | null
  /**
   * Where the playable track comes from. The file is always
   * `media/audio/<audio.youtubeId>.m4a`; for `music_video` the analysis stage
   * extracts it from `media/video/<id>.mp4` first.
   */
  readonly audio: { readonly youtubeId: string; readonly kind: AudioKind } | null
  /** The video the "Watch music video" popup plays (`media/video/<id>.mp4`). */
  readonly musicVideo: { readonly youtubeId: string; readonly kind: VideoKind } | null
  /** Every linked video, including `musicVideo`. */
  readonly videos: ReadonlyArray<CatalogVideo>
  /** Thumbnail used as the album cover (`media/thumbs/<id>.jpg`, Topic art track preferred). */
  readonly coverYoutubeId: string | null
  readonly viewCount: number | null
  readonly isImpact: boolean
  /** Slug of `data/curated/impact/<slug>.json` when isImpact. */
  readonly impactSlug: string | null
  readonly description: string | null
}

/** `media/analysis/<youtubeId>.json` — per audio file, written by `analyze`. */
export interface AudioAnalysisFile {
  readonly youtubeId: string
  readonly duration: number
  readonly bpm: number | null
  readonly bpmConfidence: number | null
  /** RhythmExtractor2013 ticks, seconds, rounded to ms. */
  readonly beats: ReadonlyArray<number>
  /** Loudness envelope sampled at `peaksRate` Hz, 0–255, base64. */
  readonly peaks: string
  readonly peaksRate: number
  readonly chorus: { readonly start: number; readonly end: number; readonly confidence: number } | null
  readonly analyzedAt: string
}

/** `media/analysis/palette/<youtubeId>.json` — written by `covers`. */
export interface PaletteFile {
  readonly youtubeId: string
  /** Hex colours, dominant first (3–5 entries). */
  readonly colors: ReadonlyArray<string>
}

/** `media/analysis/align/<songId>__<videoId>.json` — written by `align`. */
export interface AlignmentFile {
  readonly songId: string
  readonly videoId: string
  readonly songDuration: number
  readonly videoDuration: number
  readonly segments: ReadonlyArray<{
    readonly songStart: number
    readonly songEnd: number
    readonly videoStart: number
    readonly videoEnd: number
    readonly offset: number
    readonly score: number
  }>
  readonly coverage: number
  readonly confidence: number
  readonly method: string
}
