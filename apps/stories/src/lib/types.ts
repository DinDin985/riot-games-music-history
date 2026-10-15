/**
 * View models shared by the Astro pages (built at build time from
 * @workspace/db or the curated research files) and the React islands.
 * Pure types only — safe to import from client code.
 */
import type { Award, ImpactStory } from "@workspace/db/domain/types"

export type { Award, ImpactStory }

export interface GameInfo {
  readonly id: string
  readonly name: string
  readonly short: string
  readonly color: string
}

/** The song an impact story is about, resolved against the archive. */
export interface StorySong {
  /** Archive song id (Next.js `/songs/<id>`); null when the song is not in the archive (yet). */
  readonly id: string | null
  readonly title: string
  readonly displayArtist: string
  readonly year: number | null
  readonly duration: number | null
  /** `/media/...` URLs or null when the file is missing. */
  readonly audioUrl: string | null
  readonly coverUrl: string | null
  readonly gifUrl: string | null
  readonly palette: ReadonlyArray<string>
  /** YouTube id of the song's music video (the one the Next.js popup plays). */
  readonly musicVideoId: string | null
  /** Base64 loudness envelope (SongAnalysis.peaks) for the waveform, when analysed. */
  readonly peaks: string | null
  readonly peaksRate: number | null
}

/** What the big media slot of a story shows, best available first. */
export type FeaturedMedia =
  | {
      readonly kind: "video"
      readonly src: string
      readonly poster: string | null
      /** Loop only this part of the file (seconds) — used when playing a segment of the full MV. */
      readonly segment: { readonly start: number; readonly end: number } | null
      readonly caption: string | null
      readonly source: "clip" | "music-video"
    }
  | { readonly kind: "image"; readonly src: string; readonly caption: string | null; readonly source: "clip" | "song-gif" }
  | { readonly kind: "backdrop"; readonly poster: string | null; readonly caption: string | null }

/** A link to a moment inside a video: the Next.js song page when it is the song's MV, else YouTube. */
export interface MomentLink {
  readonly href: string
  readonly external: boolean
  /** Local MP4 of that video, when downloaded (lets the page play it in place). */
  readonly localVideoUrl: string | null
}

export interface StoryView {
  readonly story: ImpactStory
  readonly song: StorySong
  readonly game: GameInfo | null
  readonly featured: FeaturedMedia
  /** "Watch from m:ss" action for the featured clip. */
  readonly featuredWatch: (MomentLink & { readonly start: number; readonly youtubeId: string }) | null
}

/** Track handed to the mini player islands. */
export interface PlayerTrack {
  readonly songId: string | null
  readonly title: string
  readonly displayArtist: string
  readonly audioUrl: string
  readonly coverUrl: string | null
  readonly palette: ReadonlyArray<string>
  readonly duration: number | null
  readonly peaks: string | null
  readonly peaksRate: number | null
}

export const trackOf = (song: StorySong): PlayerTrack | null =>
  song.audioUrl
    ? {
        songId: song.id,
        title: song.title,
        displayArtist: song.displayArtist,
        audioUrl: song.audioUrl,
        coverUrl: song.coverUrl,
        palette: song.palette,
        duration: song.duration,
        peaks: song.peaks,
        peaksRate: song.peaksRate,
      }
    : null
