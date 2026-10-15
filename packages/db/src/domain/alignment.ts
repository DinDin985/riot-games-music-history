/**
 * Song ⇄ music-video time mapping.
 *
 * Music videos rarely line up with the released track by a single offset: they
 * add cold opens, cut a verse, insert dialogue or a scene, or extend an outro.
 * The pipeline matches the *audio* of the two files and stores a list of
 * segments; within a segment the video plays the same audio as the song at a
 * constant offset (`videoTime = songTime + offset`).
 *
 * Pure module — safe to import from server code, client components and Astro.
 */

export interface AlignmentSegment {
  /** Song time where this matched span starts (seconds). */
  readonly songStart: number
  readonly songEnd: number
  /** Video time where the same audio starts (seconds). */
  readonly videoStart: number
  readonly videoEnd: number
  /** `videoTime - songTime` inside this span (seconds). */
  readonly offset: number
  /** Match strength (z-score of the chroma match, higher is better). */
  readonly score: number
}

export interface Alignment {
  readonly songId: string
  readonly videoId: string
  readonly songDuration: number
  readonly videoDuration: number
  /** Sorted by songStart; video time is monotonic across segments. */
  readonly segments: ReadonlyArray<AlignmentSegment>
  /** Fraction of the song that was found in the video (0–1). */
  readonly coverage: number
  /** Overall confidence (0–1). */
  readonly confidence: number
  readonly method: string
}

export type SongToVideo =
  /** The song moment exists in the video. */
  | { readonly kind: "exact"; readonly videoTime: number; readonly segmentIndex: number }
  /** The song moment was cut from the video; this is where the video resumes the song. */
  | { readonly kind: "snapped"; readonly videoTime: number; readonly segmentIndex: number }
  /** Past the last matched span: the video has nothing for this part of the song. */
  | { readonly kind: "none"; readonly videoTime: number }

export type VideoToSong =
  | { readonly kind: "exact"; readonly songTime: number; readonly segmentIndex: number }
  /** The video is showing material that is not in the song (intro, skit, dialogue…). */
  | {
      readonly kind: "video-only"
      /** Where the song will pick up again once the video gets back to it. */
      readonly resumeSongTime: number
      /** Video time at which matched audio resumes (or the end of the video). */
      readonly resumesAtVideoTime: number
    }

/** Map a moment of the song to the music video. */
export const songToVideo = (alignment: Pick<Alignment, "segments">, songTime: number): SongToVideo => {
  const segments = alignment.segments
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (songTime < s.songStart) {
      return { kind: "snapped", videoTime: s.videoStart, segmentIndex: i }
    }
    if (songTime < s.songEnd) {
      return { kind: "exact", videoTime: songTime + s.offset, segmentIndex: i }
    }
  }
  const last = segments[segments.length - 1]
  return { kind: "none", videoTime: last ? last.videoEnd : 0 }
}

/** Map a moment of the music video back to the song. */
export const videoToSong = (
  alignment: Pick<Alignment, "segments" | "songDuration" | "videoDuration">,
  videoTime: number,
): VideoToSong => {
  const segments = alignment.segments
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (videoTime < s.videoStart) {
      return { kind: "video-only", resumeSongTime: s.songStart, resumesAtVideoTime: s.videoStart }
    }
    if (videoTime < s.videoEnd) {
      return { kind: "exact", songTime: videoTime - s.offset, segmentIndex: i }
    }
  }
  const last = segments[segments.length - 1]
  return {
    kind: "video-only",
    resumeSongTime: last ? last.songEnd : alignment.songDuration,
    resumesAtVideoTime: alignment.videoDuration,
  }
}

/** Identity alignment for a song whose audio was taken from the video itself. */
export const identityAlignment = (songId: string, videoId: string, duration: number): Alignment => ({
  songId,
  videoId,
  songDuration: duration,
  videoDuration: duration,
  segments: [{ songStart: 0, songEnd: duration, videoStart: 0, videoEnd: duration, offset: 0, score: 99 }],
  coverage: 1,
  confidence: 1,
  method: "identity",
})
