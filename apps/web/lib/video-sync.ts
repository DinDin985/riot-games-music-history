import { songToVideo, videoToSong, type Alignment, type AlignmentSegment } from "@workspace/db/domain/alignment"

/**
 * Timing logic of the synced music-video popup (components/video/*).
 *
 * Every song ⇄ video conversion goes through the stored *audio* alignment
 * (`songToVideo` / `videoToSong`), never raw time: music videos add cold opens
 * and skits, cut verses and extend outros, so one offset is not enough.
 *
 * Two playback modes use these helpers:
 * - hand-off (default): the song pauses, the video plays with its own audio
 *   from `startPoint()`; the player's clock follows `songClockAt()`; closing
 *   continues the song at `handBackPoint()`.
 * - lock to track: the song keeps playing and the muted video is slaved to it
 *   frame by frame — `lockTarget()` says where the video should be and
 *   `driftDecision()` how to get it there (playbackRate nudge or hard seek).
 *
 * Pure module (no DOM, no React) — unit-tested in `video-sync.test.ts`.
 */

// ---------------------------------------------------------------------------
// Tunables

/** Snaps shorter than this (song seconds) are imprecision between segments, not a real cut: no notice. */
export const SILENT_SNAP_SECONDS = 1
/** Song gaps between two segments shorter than this are played through in lock mode (no "not in the video" flash). */
export const MICRO_GAP_SECONDS = 0.5
/** Video-only spans / song cuts shorter than this are ignored by the UI (badge, timeline). */
export const MIN_SPAN_SECONDS = 1.5
/** Closing within this distance of the song's end counts as "finished" (the song is not resumed). */
export const END_EPSILON_SECONDS = 0.5

export const DRIFT = {
  /** Drift above this → hard seek. */
  hardSeek: 0.25,
  /** Start nudging playbackRate above this drift… */
  nudgeStart: 0.04,
  /** …and keep nudging until the drift is below this (hysteresis). */
  nudgeStop: 0.015,
  /** playbackRate change per second of drift. */
  nudgeGain: 0.6,
  /** Largest playbackRate change (±). */
  nudgeMax: 0.08,
  /** While paused, re-seek for frame accuracy above this drift. */
  pausedSeek: 0.04,
  /** After a hard seek the decoder needs a moment: no further hard seek for this long (ms). */
  seekCooldownMs: 450,
  /** Upper bound for the seek lead (s) that compensates seek latency while playing. */
  maxLead: 0.5,
} as const

// ---------------------------------------------------------------------------
// Small helpers

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const positive = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null

/** Drop malformed segments and sort by song time (the domain functions expect sorted, monotonic input). */
export function normalizeSegments(segments: ReadonlyArray<AlignmentSegment>): ReadonlyArray<AlignmentSegment> {
  return segments
    .filter(
      (s) =>
        [s.songStart, s.songEnd, s.videoStart, s.videoEnd, s.offset].every(Number.isFinite) &&
        s.songEnd > s.songStart &&
        s.videoEnd > s.videoStart,
    )
    .slice()
    .sort((a, b) => a.songStart - b.songStart)
}

const songLength = (a: Pick<Alignment, "segments" | "songDuration">): number =>
  Math.max(
    positive(a.songDuration) ?? 0,
    a.segments.reduce((m, s) => Math.max(m, s.songEnd), 0),
  )

const videoLength = (a: Pick<Alignment, "segments" | "videoDuration">): number =>
  Math.max(
    positive(a.videoDuration) ?? 0,
    a.segments.reduce((m, s) => Math.max(m, s.videoEnd), 0),
  )

/**
 * Clamp a mapped video time into the file. Stored segments may start at video
 * 0 with a negative offset (the song begins a few ms before the video's first
 * frame), so `songTime + offset` can dip below zero.
 */
const inVideo = (a: Pick<Alignment, "segments" | "videoDuration">, t: number): number => {
  const len = videoLength(a)
  return clamp(t, 0, len > 0 ? len : Math.max(0, t))
}

// ---------------------------------------------------------------------------
// Which mapping to use

/**
 * - `identity`: the track's audio *is* the video's audio (perfect sync);
 * - `matched`: the pipeline matched the two by audio (segments, confidence);
 * - `approximate`: no usable alignment yet — one-to-one guess, flagged in the UI.
 */
export type SyncQuality = "identity" | "matched" | "approximate"

export interface SyncMap {
  readonly alignment: Alignment
  readonly quality: SyncQuality
}

export interface ResolveSyncInput {
  readonly songId: string
  readonly videoId: string
  /** From `GET /api/songs/:id/alignment` (null on 404). */
  readonly alignment: Alignment | null
  /** The playable track was extracted from this very video (audioKind "music_video" or the same YouTube id). */
  readonly sharesAudio: boolean
  /** Song length (s), when known. */
  readonly songDuration: number | null
  /** Video length (s) — the `<video>` element's duration once its metadata loaded. */
  readonly videoDuration: number | null
}

/** Fallback length when neither duration is known yet (a mapping must still exist). */
const UNKNOWN_LENGTH = 24 * 3600

/** Choose the mapping for the popup: stored alignment → identity (shared audio) → approximate identity. */
export function resolveSync(input: ResolveSyncInput): SyncMap {
  const stored = input.alignment
  const segments = stored && stored.videoId === input.videoId ? normalizeSegments(stored.segments) : []
  if (stored && segments.length > 0) {
    const alignment: Alignment = {
      ...stored,
      segments,
      songDuration:
        positive(stored.songDuration) ?? positive(input.songDuration) ?? songLength({ segments, songDuration: 0 }),
      videoDuration:
        positive(input.videoDuration) ?? positive(stored.videoDuration) ?? videoLength({ segments, videoDuration: 0 }),
    }
    return {
      alignment,
      quality: stored.method === "identity" ? "identity" : "matched",
    }
  }

  const song = positive(input.songDuration) ?? positive(stored?.songDuration)
  const video = positive(input.videoDuration) ?? positive(stored?.videoDuration)
  const identity = input.sharesAudio
  // Shared audio maps one-to-one over the whole file; a guess only where both files exist.
  const length = identity
    ? Math.max(song ?? 0, video ?? 0) || UNKNOWN_LENGTH
    : song !== null && video !== null
      ? Math.min(song, video)
      : (song ?? video ?? UNKNOWN_LENGTH)
  return {
    quality: identity ? "identity" : "approximate",
    alignment: {
      songId: input.songId,
      videoId: input.videoId,
      songDuration: song ?? length,
      videoDuration: video ?? length,
      segments: [
        {
          songStart: 0,
          songEnd: length,
          videoStart: 0,
          videoEnd: length,
          offset: 0,
          score: identity ? 99 : 0,
        },
      ],
      coverage: identity ? 1 : song ? Math.min(1, length / song) : 0,
      confidence: identity ? 1 : 0,
      method: identity ? "identity" : "approximate",
    },
  }
}

// ---------------------------------------------------------------------------
// Hand-off mode

export interface SongClock {
  /** Song position to show while the video plays this moment. */
  readonly songTime: number
  /** The video is showing material that is not in the song (intro, skit, outro…). */
  readonly videoOnly: boolean
  /** Matched segment playing now (null while video-only). */
  readonly segmentIndex: number | null
  /** Video-only: song time at which the video picks the song up again. */
  readonly resumeSongTime: number | null
}

/**
 * The song moment a video moment corresponds to. During video-only material
 * the song clock *holds* where the song left off (the end of the previous
 * matched segment, or the first segment's start before any music).
 */
export function songClockAt(alignment: Alignment, videoTime: number): SongClock {
  const m = videoToSong(alignment, videoTime)
  if (m.kind === "exact") {
    return {
      songTime: Math.max(0, m.songTime),
      videoOnly: false,
      segmentIndex: m.segmentIndex,
      resumeSongTime: null,
    }
  }
  let held: number | null = null
  for (const s of alignment.segments) if (s.videoEnd <= videoTime) held = s.songEnd
  return {
    songTime: held ?? alignment.segments[0]?.songStart ?? 0,
    videoOnly: true,
    segmentIndex: null,
    resumeSongTime: m.resumeSongTime,
  }
}

export type StartKind =
  /** The song moment is in the video. */
  | "exact"
  /** That part of the song was cut from the video: starting where the video picks the song back up. */
  | "snapped"
  /** The video ends before this part of the song: starting the video from the top. */
  | "restart"
  /** An explicit video time was requested (curated key moment). */
  | "video"

export interface StartPoint {
  readonly kind: StartKind
  readonly videoTime: number
  /** Song position matching `videoTime` (what the player shows). */
  readonly songTime: number
  /** The song moment that was asked for (set for snapped / restart). */
  readonly requestedSongTime: number | null
}

/** Where the popup starts the video for `{ songTime }` (mapped) or `{ videoTime }` (exact). */
export function startPoint(
  alignment: Alignment,
  request: {
    readonly songTime?: number | undefined
    readonly videoTime?: number | undefined
  },
): StartPoint {
  const vLen = videoLength(alignment)
  if (request.videoTime !== undefined && Number.isFinite(request.videoTime)) {
    const videoTime = clamp(request.videoTime, 0, vLen > 0 ? vLen : request.videoTime)
    return {
      kind: "video",
      videoTime,
      songTime: songClockAt(alignment, videoTime).songTime,
      requestedSongTime: null,
    }
  }
  const requested = Math.max(0, Number.isFinite(request.songTime) ? (request.songTime ?? 0) : 0)
  const m = songToVideo(alignment, requested)
  if (m.kind === "exact")
    return {
      kind: "exact",
      videoTime: inVideo(alignment, m.videoTime),
      songTime: requested,
      requestedSongTime: null,
    }
  if (m.kind === "snapped") {
    const resumeSong = alignment.segments[m.segmentIndex]!.songStart
    // A sub-second hole between segments is aligner imprecision: play through without a notice.
    if (resumeSong - requested < SILENT_SNAP_SECONDS) {
      return {
        kind: "exact",
        videoTime: inVideo(alignment, m.videoTime),
        songTime: resumeSong,
        requestedSongTime: null,
      }
    }
    return {
      kind: "snapped",
      videoTime: inVideo(alignment, m.videoTime),
      songTime: resumeSong,
      requestedSongTime: requested,
    }
  }
  return {
    kind: "restart",
    videoTime: 0,
    songTime: songClockAt(alignment, 0).songTime,
    requestedSongTime: requested,
  }
}

export interface HandBack {
  /** Song time to continue from. */
  readonly songTime: number
  /** The song has (practically) finished — do not resume playback. */
  readonly atEnd: boolean
}

/** Closing the popup at `videoTime`: the song continues at the same musical moment (or where the video would resume it). */
export function handBackPoint(alignment: Alignment, videoTime: number): HandBack {
  const m = videoToSong(alignment, videoTime)
  const raw = m.kind === "exact" ? m.songTime : m.resumeSongTime
  const length = songLength(alignment)
  const songTime = clamp(raw, 0, length > 0 ? length : Math.max(0, raw))
  return {
    songTime,
    atEnd: length > 0 && songTime >= length - END_EPSILON_SECONDS,
  }
}

/**
 * ←/→ in hand-off mode: the video time `delta` seconds *of song* away. Falls
 * back to a plain video step when the song step would barely move the video
 * (e.g. stepping back into a part of the song that the video cut).
 */
export function stepVideoBySong(alignment: Alignment, videoTime: number, delta: number): number {
  const vLen = videoLength(alignment)
  const sLen = songLength(alignment)
  const clock = songClockAt(alignment, videoTime)
  const target = clamp(clock.songTime + delta, 0, sLen > 0 ? sLen : clock.songTime + Math.abs(delta))
  const m = songToVideo(alignment, target)
  let next = m.kind === "none" ? vLen : inVideo(alignment, m.videoTime)
  const moved = next - videoTime
  if (Math.sign(moved) !== Math.sign(delta) || Math.abs(moved) < Math.abs(delta) / 2) next = videoTime + delta
  return clamp(next, 0, vLen > 0 ? vLen : Math.max(0, next))
}

// ---------------------------------------------------------------------------
// Lock-to-track mode

export type LockTarget =
  /** The video should be at `videoTime`, playing. */
  | {
      readonly kind: "play"
      readonly videoTime: number
      readonly segmentIndex: number
    }
  /** This part of the song is not in the video; it picks the song up again at `resumeSongTime`. */
  | {
      readonly kind: "gap"
      readonly resumeVideoTime: number
      readonly resumeSongTime: number
      readonly segmentIndex: number
    }
  /** Past the last matched segment: the video has nothing more for this song. */
  | { readonly kind: "ended"; readonly lastVideoTime: number }

/** Where the slaved video should be for song time `songTime`. */
export function lockTarget(alignment: Alignment, songTime: number): LockTarget {
  const m = songToVideo(alignment, songTime)
  if (m.kind === "exact")
    return {
      kind: "play",
      videoTime: inVideo(alignment, m.videoTime),
      segmentIndex: m.segmentIndex,
    }
  if (m.kind === "snapped") {
    const seg = alignment.segments[m.segmentIndex]!
    const prev = alignment.segments[m.segmentIndex - 1]
    const gapLength = seg.songStart - (prev ? prev.songEnd : 0)
    // Micro-gap between two segments: keep playing through it on the next segment's clock.
    if (prev && gapLength < MICRO_GAP_SECONDS) {
      return {
        kind: "play",
        videoTime: inVideo(alignment, songTime + seg.offset),
        segmentIndex: m.segmentIndex,
      }
    }
    return {
      kind: "gap",
      resumeVideoTime: inVideo(alignment, m.videoTime),
      resumeSongTime: seg.songStart,
      segmentIndex: m.segmentIndex,
    }
  }
  return { kind: "ended", lastVideoTime: m.videoTime }
}

export interface DriftInput {
  /** Where the video should be (s). */
  readonly target: number
  /** `video.currentTime`. */
  readonly actual: number
  /** Whether the song (and so the video) is playing. */
  readonly playing: boolean
  /** Current `video.playbackRate`. */
  readonly rate: number
  /** The target moved to another segment since the last frame (a cut: the video must jump). */
  readonly segmentChanged: boolean
  /** Milliseconds since the last hard seek (Infinity when none). */
  readonly msSinceSeek: number
  /** Seconds to seek ahead of the target while playing, to cover seek latency (see `updateSeekLead`). */
  readonly lead?: number
}

export type DriftAction =
  | { readonly kind: "hold"; readonly rate: 1; readonly drift: number }
  | { readonly kind: "nudge"; readonly rate: number; readonly drift: number }
  | {
      readonly kind: "seek"
      readonly to: number
      readonly rate: 1
      readonly drift: number
    }

/**
 * Drift correction for the slaved video. `drift = target − actual` (positive:
 * the video is behind). Small drift → playbackRate nudge (with hysteresis);
 * drift above 250 ms or a segment change → hard seek (not during the
 * post-seek cooldown, where it nudges at full strength instead).
 */
export function driftDecision(input: DriftInput): DriftAction {
  const drift = input.target - input.actual
  const abs = Math.abs(drift)
  const lead = input.playing ? clamp(input.lead ?? 0, 0, DRIFT.maxLead) : 0
  const seek = (): DriftAction => ({
    kind: "seek",
    to: Math.max(0, input.target + lead),
    rate: 1,
    drift,
  })

  if (input.segmentChanged) return seek()
  if (!input.playing) return abs > DRIFT.pausedSeek ? seek() : { kind: "hold", rate: 1, drift }
  if (abs > DRIFT.hardSeek) {
    if (input.msSinceSeek >= DRIFT.seekCooldownMs) return seek()
    return { kind: "nudge", rate: 1 + Math.sign(drift) * DRIFT.nudgeMax, drift }
  }
  const nudging = Math.abs(input.rate - 1) > 1e-6
  if (abs > (nudging ? DRIFT.nudgeStop : DRIFT.nudgeStart)) {
    return {
      kind: "nudge",
      rate: 1 + clamp(drift * DRIFT.nudgeGain, -DRIFT.nudgeMax, DRIFT.nudgeMax),
      drift,
    }
  }
  return { kind: "hold", rate: 1, drift }
}

/** Learn the seek lead from the lag observed right after a seek while playing (EMA, clamped). */
export function updateSeekLead(lead: number, observedLag: number): number {
  if (!Number.isFinite(observedLag)) return lead
  return clamp(lead * 0.6 + observedLag * 0.4, 0, DRIFT.maxLead)
}

// ---------------------------------------------------------------------------
// Spans and the "audio match" timeline

export interface Span {
  readonly start: number
  readonly end: number
}

/** Video material that is not in the song (intro, skit, dialogue, outro), at least `minLength` long. */
export function videoOnlySpans(alignment: Alignment, minLength = MIN_SPAN_SECONDS): ReadonlyArray<Span> {
  const sorted = [...alignment.segments].sort((a, b) => a.videoStart - b.videoStart)
  const out: Span[] = []
  let cursor = 0
  for (const s of sorted) {
    if (s.videoStart - cursor >= minLength) out.push({ start: cursor, end: s.videoStart })
    cursor = Math.max(cursor, s.videoEnd)
  }
  const end = videoLength(alignment)
  if (end - cursor >= minLength) out.push({ start: cursor, end })
  return out
}

/** Parts of the song that the video cut, at least `minLength` long. */
export function songCutSpans(alignment: Alignment, minLength = MIN_SPAN_SECONDS): ReadonlyArray<Span> {
  const out: Span[] = []
  let cursor = 0
  for (const s of alignment.segments) {
    if (s.songStart - cursor >= minLength) out.push({ start: cursor, end: s.songStart })
    cursor = Math.max(cursor, s.songEnd)
  }
  const end = songLength(alignment)
  if (end - cursor >= minLength) out.push({ start: cursor, end })
  return out
}

/** The span containing `t`, if any. */
export function spanAt(spans: ReadonlyArray<Span>, t: number): Span | null {
  for (const s of spans) if (t >= s.start && t < s.end) return s
  return null
}

export interface MatchLink {
  readonly index: number
  /** Fractions (0–1) of the song bar. */
  readonly song: Span
  /** Fractions (0–1) of the video bar. */
  readonly video: Span
  readonly score: number
}

export interface MatchLayout {
  readonly songDuration: number
  readonly videoDuration: number
  readonly links: ReadonlyArray<MatchLink>
  /** Song parts not in the video (fractions of the song bar). */
  readonly songCuts: ReadonlyArray<Span>
  /** Video-only material (fractions of the video bar). */
  readonly videoOnly: ReadonlyArray<Span>
}

/** Geometry of the compact "song bar ⇄ video bar" timeline, as fractions of each bar. */
export function matchLayout(alignment: Alignment): MatchLayout {
  const songDuration = songLength(alignment)
  const videoDuration = videoLength(alignment)
  const fs = (t: number) => (songDuration > 0 ? clamp(t / songDuration, 0, 1) : 0)
  const fv = (t: number) => (videoDuration > 0 ? clamp(t / videoDuration, 0, 1) : 0)
  return {
    songDuration,
    videoDuration,
    links: alignment.segments.map((s, index) => ({
      index,
      song: { start: fs(s.songStart), end: fs(s.songEnd) },
      video: { start: fv(s.videoStart), end: fv(s.videoEnd) },
      score: s.score,
    })),
    songCuts: songCutSpans(alignment).map((s) => ({
      start: fs(s.start),
      end: fs(s.end),
    })),
    videoOnly: videoOnlySpans(alignment).map((s) => ({
      start: fv(s.start),
      end: fv(s.end),
    })),
  }
}

// ---------------------------------------------------------------------------
// Confidence chip

export interface SyncBadge {
  readonly label: string
  readonly tone: "exact" | "good" | "fair" | "weak" | "approximate"
  /** One-line explanation for the tooltip. */
  readonly detail: string
}

export function syncBadge(sync: SyncMap): SyncBadge {
  const a = sync.alignment
  if (sync.quality === "identity") {
    return {
      label: "Same audio",
      tone: "exact",
      detail: "The track's audio comes from this video, so they are in perfect sync.",
    }
  }
  if (sync.quality === "approximate") {
    return {
      label: "Approximate sync",
      tone: "approximate",
      detail: "This video has not been audio-matched to the track yet, so times are mapped one-to-one.",
    }
  }
  const pct = Math.round(clamp(a.confidence, 0, 1) * 100)
  const coverage = Math.round(clamp(a.coverage, 0, 1) * 100)
  const n = a.segments.length
  const cuts = songCutSpans(a).length
  const extras = videoOnlySpans(a).length
  const parts = [
    `${coverage}% of the song is in the video`,
    `${n} matched ${n === 1 ? "section" : "sections"}`,
    cuts > 0 ? `${cuts} ${cuts === 1 ? "cut" : "cuts"}` : null,
    extras > 0 ? `${extras} video-only ${extras === 1 ? "scene" : "scenes"}` : null,
  ].filter(Boolean)
  return {
    label: `Audio match ${pct}%`,
    tone: a.confidence >= 0.75 ? "good" : a.confidence >= 0.45 ? "fair" : "weak",
    detail: `Matched by audio: ${parts.join(" · ")}.`,
  }
}
