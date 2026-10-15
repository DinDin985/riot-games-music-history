/**
 * One shared <audio> element for every player island on a page (play buttons
 * on the cards + the bottom mini player). ES modules are singletons, so all
 * islands importing this file see the same store.
 *
 * Playback position is written to localStorage[PLAYER_STORAGE_KEY] in the
 * same `PersistedPlayerState` shape the Next.js player uses, so a song started
 * here continues in the main app (and vice versa via the resume offer).
 */
import { useSyncExternalStore } from "react"
import { PLAYER_STORAGE_KEY, type PersistedPlayerState } from "@workspace/ui/lib/site-nav"
import type { PlayerTrack } from "../../lib/types.ts"

export interface PlayerState {
  readonly track: PlayerTrack | null
  readonly playing: boolean
  readonly loading: boolean
  /** Seconds; updated on `timeupdate` (~4 Hz). Use `currentTime()` for animation. */
  readonly time: number
  readonly duration: number
  readonly volume: number
  readonly error: string | null
}

const INITIAL: PlayerState = {
  track: null,
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  volume: 1,
  error: null,
}

let state: PlayerState = INITIAL
const listeners = new Set<() => void>()
const emit = (patch: Partial<PlayerState>) => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

let audio: HTMLAudioElement | null = null
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let queue: ReadonlyArray<string> = []
let lastPersist = 0

// ---------------------------------------------------------------------------
// Persistence (shared with the Next.js player)

const isPersisted = (value: unknown): value is PersistedPlayerState => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.songId === "string" &&
    typeof v.title === "string" &&
    typeof v.audioUrl === "string" &&
    typeof v.time === "number" &&
    Number.isFinite(v.time)
  )
}

export const readPersisted = (): PersistedPlayerState | null => {
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!isPersisted(parsed)) return null
    return {
      ...parsed,
      displayArtist: typeof parsed.displayArtist === "string" ? parsed.displayArtist : "",
      coverUrl: typeof parsed.coverUrl === "string" ? parsed.coverUrl : null,
      palette: Array.isArray(parsed.palette) ? parsed.palette.filter((c) => typeof c === "string") : [],
      volume: typeof parsed.volume === "number" ? parsed.volume : 1,
      queue: Array.isArray(parsed.queue) ? parsed.queue.filter((q) => typeof q === "string") : [],
    }
  } catch {
    return null
  }
}

const persist = () => {
  const track = state.track
  // The Next.js player resumes by song id; tracks outside the archive are not persisted.
  if (!track?.songId || !audio) return
  const payload: PersistedPlayerState = {
    songId: track.songId,
    title: track.title,
    displayArtist: track.displayArtist,
    audioUrl: track.audioUrl,
    coverUrl: track.coverUrl,
    palette: track.palette,
    time: Math.round(audio.currentTime * 10) / 10,
    volume: audio.volume,
    queue: queue.length > 0 ? queue : [track.songId],
    savedAt: Date.now(),
  }
  lastPersist = Date.now()
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage full or disabled: resume simply won't be offered.
  }
}

/** Turn a saved Next.js player state back into a playable track. */
export const trackFromPersisted = (saved: PersistedPlayerState): PlayerTrack => ({
  songId: saved.songId,
  title: saved.title,
  displayArtist: saved.displayArtist,
  audioUrl: saved.audioUrl,
  coverUrl: saved.coverUrl,
  palette: saved.palette,
  duration: null,
  peaks: null,
  peaksRate: null,
})

// ---------------------------------------------------------------------------
// Audio element

const ensureAudio = (): HTMLAudioElement => {
  if (audio) return audio
  const el = new Audio()
  el.preload = "metadata"
  el.addEventListener("timeupdate", () => {
    emit({ time: el.currentTime })
    if (Date.now() - lastPersist > 2000 && !el.paused) persist()
  })
  el.addEventListener("durationchange", () => {
    if (Number.isFinite(el.duration)) emit({ duration: el.duration })
  })
  el.addEventListener("play", () => {
    emit({ playing: true, error: null })
    void audioContext?.resume()
  })
  el.addEventListener("pause", () => {
    emit({ playing: false })
    persist()
  })
  el.addEventListener("waiting", () => emit({ loading: true }))
  el.addEventListener("playing", () => emit({ loading: false }))
  el.addEventListener("canplay", () => emit({ loading: false }))
  el.addEventListener("ended", () => {
    emit({ playing: false })
    persist()
  })
  el.addEventListener("error", () => emit({ playing: false, loading: false, error: "This track could not be loaded." }))
  el.addEventListener("volumechange", () => emit({ volume: el.volume }))
  window.addEventListener("pagehide", persist)
  audio = el
  return el
}

/** Current position read straight from the element (smooth, for rAF animations). */
export const currentTime = (): number => audio?.currentTime ?? state.time

/**
 * Lazily route the element through an AnalyserNode for the live waveform
 * (only used when a track has no precomputed peaks). Same-origin audio only:
 * cross-origin media without CORS would be silenced by Web Audio.
 */
export const getAnalyser = (): AnalyserNode | null => {
  if (analyser) return analyser
  if (!audio || !state.track || !state.track.audioUrl.startsWith("/")) return null
  try {
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return null
    audioContext = new Context()
    const node = audioContext.createAnalyser()
    node.fftSize = 256
    node.smoothingTimeConstant = 0.78
    audioContext.createMediaElementSource(audio).connect(node)
    node.connect(audioContext.destination)
    if (!audio.paused) void audioContext.resume()
    analyser = node
  } catch {
    analyser = null
  }
  return analyser
}

export const player = {
  /** Load `track` (if it is not already loaded) and optionally start at `startAt` seconds. */
  load(track: PlayerTrack, options: { readonly startAt?: number; readonly autoplay?: boolean; readonly volume?: number } = {}) {
    const el = ensureAudio()
    const { startAt = 0, autoplay = true } = options
    if (options.volume !== undefined) el.volume = Math.min(1, Math.max(0, options.volume))
    if (state.track?.audioUrl !== track.audioUrl) {
      el.src = track.audioUrl
      queue = track.songId ? [track.songId] : []
      emit({ track, time: startAt, duration: track.duration ?? 0, error: null, loading: autoplay })
      if (startAt > 0) el.addEventListener("loadedmetadata", () => (el.currentTime = startAt), { once: true })
    } else if (startAt > 0) {
      el.currentTime = startAt
    }
    if (autoplay) el.play().catch(() => emit({ playing: false, loading: false }))
  },
  /** Play/pause `track`, switching to it first when another one is loaded. */
  toggle(track?: PlayerTrack | null) {
    if (track && state.track?.audioUrl !== track.audioUrl) return player.load(track)
    const el = audio
    if (!el || !state.track) return track ? player.load(track) : undefined
    if (el.paused) el.play().catch(() => emit({ playing: false }))
    else el.pause()
  },
  seek(seconds: number) {
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds))
    emit({ time: audio.currentTime })
  },
  setVolume(volume: number) {
    ensureAudio().volume = Math.min(1, Math.max(0, volume))
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => state,
}

export const usePlayer = (): PlayerState =>
  useSyncExternalStore(player.subscribe, player.getSnapshot, () => INITIAL)

/** True when `track` is the one loaded in the shared player. */
export const isCurrent = (s: PlayerState, track: PlayerTrack | null | undefined): boolean =>
  !!track && s.track?.audioUrl === track.audioUrl
