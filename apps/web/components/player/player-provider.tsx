"use client"

import * as React from "react"
import { toast } from "sonner"
import type { SongAnalysis, SongDetail, SongSummary } from "@workspace/db/domain/types"
import { fetchSong, fetchSongAnalysis, fetchSongsByIds } from "@/lib/api-client"
import { readPersistedPlayer, songFromPersisted, writePersistedPlayer } from "@/components/player/player-storage"
import { TimeStore } from "@/components/player/time-store"
import { MusicVideoDialog } from "@/components/video/music-video-dialog"

/**
 * The global audio player.
 *
 * One `HTMLAudioElement` for the whole app, routed (after the first user
 * gesture) through a Web Audio graph `source → analyser → gain → speakers`, so
 * waveforms can draw the live spectrum. State that changes a few times per song
 * (song, queue, play/pause, volume, analysis…) lives in React context and is
 * read with `usePlayer()`; the playback position changes every frame and is
 * read with `useCurrentTime(fps)` or pulled with `getCurrentTime()` so the tree
 * does not re-render at 60 fps.
 *
 * The state is persisted to localStorage (`PLAYER_STORAGE_KEY`) so a reload —
 * or a visit to the Astro `/awards` and `/impact` pages — resumes where it left off.
 */

/** Options for `openVideo`. */
export interface OpenVideoOptions {
  /** Song time (s) the video should start at (mapped through the alignment). Default: the current position. */
  readonly songTime?: number
  /** Start the video at this exact *video* time instead (e.g. a curated key moment). */
  readonly videoTime?: number
  /** Open the music video of this song (it becomes the current song, paused) instead of the current one. */
  readonly song?: SongSummary
}

/** What the music-video dialog should show; set by `openVideo`. */
export interface VideoRequest {
  readonly song: SongSummary
  /** Song time to sync to (absent when `videoTime` is given). */
  readonly songTime?: number
  readonly videoTime?: number
  /** Whether the audio was playing when the video opened — the dialog may resume it on close. */
  readonly wasPlaying: boolean
  /** Changes on every `openVideo` call, so an already-open dialog can re-seek. */
  readonly nonce: number
}

export interface PlayerContextValue {
  /** The loaded song (playing or paused), null before anything was played. */
  readonly song: SongSummary | null
  /** Full detail of `song` (artists with ids, music video…), fetched in the background. */
  readonly detail: SongDetail | null
  readonly queue: ReadonlyArray<SongSummary>
  /** Index of `song` in `queue` (-1 when empty). */
  readonly queueIndex: number
  readonly isPlaying: boolean
  /** Waiting for data (buffering / loading a new song). */
  readonly isLoading: boolean
  /** Seconds (0 until metadata loads). */
  readonly duration: number
  /** 0–1. */
  readonly volume: number
  readonly muted: boolean
  /** Live analyser for the current audio (null until the first play gesture or when Web Audio is unavailable). */
  readonly analyser: AnalyserNode | null
  /** Beats / peaks / chorus of the current song (null while loading or when not analysed). */
  readonly analysis: SongAnalysis | null
  readonly videoOpen: boolean
  readonly videoRequest: VideoRequest | null

  /** Play `song`. With `queue`, replaces the queue (song must be in it, else it is prepended). Same song → resume. */
  readonly play: (song: SongSummary, queue?: ReadonlyArray<SongSummary>) => void
  /** Play `song` from `time` seconds (seeks if it is already the current song). */
  readonly playAt: (song: SongSummary, time: number, queue?: ReadonlyArray<SongSummary>) => void
  readonly toggle: () => void
  readonly pause: () => void
  readonly resume: () => void
  readonly seek: (time: number) => void
  readonly next: () => void
  readonly prev: () => void
  readonly setVolume: (volume: number) => void
  readonly toggleMute: () => void
  /** Add to the queue (at the end, or right after the current song with `next: true`). */
  readonly enqueue: (song: SongSummary, options?: { readonly next?: boolean }) => void
  readonly removeFromQueue: (index: number) => void
  /** Keep only the current song. */
  readonly clearQueue: () => void

  /** Pause the audio and open the music video synced to the song (see OpenVideoOptions). */
  readonly openVideo: (options?: OpenVideoOptions) => void
  readonly closeVideo: () => void
  /** Called by the video dialog: continue the song at `songTime` (and play it when `resume`). */
  readonly setPlaybackFromVideo: (songTime: number, resume: boolean) => void
  /**
   * Called by the video dialog in hand-off mode: while set, the song position
   * (`getCurrentTime`, `useCurrentTime`, scrubbers, waveforms) follows the music
   * video — the audio itself stays paused. `null` hands the clock back to the audio.
   */
  readonly setVideoClock: (songTime: number | null) => void

  /** Current position in seconds — cheap, call it from rAF loops. */
  readonly getCurrentTime: () => number
  /** The underlying element (for advanced consumers; do not change its src). */
  readonly getAudioElement: () => HTMLAudioElement | null
  /** Subscribe to position changes (used by useCurrentTime). */
  readonly subscribeTime: (listener: () => void) => () => void
}

const PlayerContext = React.createContext<PlayerContextValue | null>(null)

export function usePlayer(): PlayerContextValue {
  const ctx = React.useContext(PlayerContext)
  if (!ctx) throw new Error("usePlayer() must be used inside <PlayerProvider>")
  return ctx
}

/** Same as usePlayer() but returns null outside the provider. */
export function usePlayerOptional(): PlayerContextValue | null {
  return React.useContext(PlayerContext)
}

/**
 * Playback position in seconds, re-rendering the caller at most `fps` times per
 * second (default 4 — enough for a clock; use 30 for a smooth scrubber).
 */
export function useCurrentTime(fps = 4): number {
  const { subscribeTime, getCurrentTime } = usePlayer()
  const getSnapshot = React.useCallback(() => Math.floor(getCurrentTime() * fps) / fps, [getCurrentTime, fps])
  return React.useSyncExternalStore(subscribeTime, getSnapshot, () => 0)
}

/** Is `songId` the loaded song, and is it playing? */
export function useSongPlayback(songId: string): { readonly isCurrent: boolean; readonly isPlaying: boolean } {
  const { song, isPlaying } = usePlayer()
  const isCurrent = song?.id === songId
  return { isCurrent, isPlaying: isCurrent && isPlaying }
}

// ---------------------------------------------------------------------------

interface AudioGraph {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  readonly gain: GainNode
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function PlayerProvider({ children }: { readonly children: React.ReactNode }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const graphRef = React.useRef<AudioGraph | null>(null)
  const timeStore = React.useMemo(() => new TimeStore(), [])
  const pendingSeek = React.useRef<number | null>(null)
  const nonce = React.useRef(0)
  /** Song position driven by the music video in hand-off mode (null = the audio element is the clock). */
  const videoClock = React.useRef<number | null>(null)

  const [song, setSong] = React.useState<SongSummary | null>(null)
  const [detail, setDetail] = React.useState<SongDetail | null>(null)
  const [queue, setQueue] = React.useState<ReadonlyArray<SongSummary>>([])
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolumeState] = React.useState(0.8)
  const [muted, setMuted] = React.useState(false)
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [analysis, setAnalysis] = React.useState<SongAnalysis | null>(null)
  const [videoOpen, setVideoOpen] = React.useState(false)
  const [videoRequest, setVideoRequest] = React.useState<VideoRequest | null>(null)

  // Latest values for event handlers registered once.
  const latest = React.useRef({ song, queue, volume, muted })
  latest.current = { song, queue, volume, muted }

  const queueIndex = song ? queue.findIndex((s) => s.id === song.id) : -1

  // ---- Persistence -------------------------------------------------------
  const persist = React.useCallback(() => {
    const audio = audioRef.current
    const { song: s, queue: q, volume: v } = latest.current
    if (!s?.audioUrl) return
    writePersistedPlayer({
      songId: s.id,
      title: s.title,
      displayArtist: s.displayArtist,
      audioUrl: s.audioUrl,
      coverUrl: s.coverUrl,
      palette: s.palette,
      time: videoClock.current ?? audio?.currentTime ?? 0,
      volume: v,
      queue: q.length > 0 ? q.map((x) => x.id) : [s.id],
      savedAt: Date.now(),
    })
  }, [])

  // ---- Web Audio graph (created once, inside a user gesture) ------------
  const applyVolume = React.useCallback((v: number, m: boolean) => {
    const audio = audioRef.current
    const graph = graphRef.current
    const effective = m ? 0 : v
    if (graph) {
      // The gain node sits after the analyser, so the waveform does not shrink with the volume.
      graph.gain.gain.setTargetAtTime(effective, graph.ctx.currentTime, 0.015)
      if (audio) audio.volume = 1
    } else if (audio) {
      audio.volume = effective
    }
  }, [])

  const ensureGraph = React.useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (graphRef.current) {
      if (graphRef.current.ctx.state === "suspended") void graphRef.current.ctx.resume().catch(() => undefined)
      return
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(audio)
      const node = ctx.createAnalyser()
      node.fftSize = 2048
      node.smoothingTimeConstant = 0.7
      node.minDecibels = -90
      node.maxDecibels = -20
      const gain = ctx.createGain()
      source.connect(node)
      node.connect(gain)
      gain.connect(ctx.destination)
      graphRef.current = { ctx, analyser: node, gain }
      applyVolume(latest.current.volume, latest.current.muted)
      setAnalyser(node)
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined)
    } catch (error) {
      // Web Audio is an enhancement: playback continues through the element alone.
      console.warn("[player] Web Audio unavailable", error)
    }
  }, [applyVolume])

  // ---- Loading / playing -------------------------------------------------
  const startPlayback = React.useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    ensureGraph()
    audio.play().catch((error: unknown) => {
      const name = (error as { name?: string }).name
      // AbortError: a newer load() interrupted this play() — expected when skipping.
      if (name === "AbortError") return
      setIsPlaying(false)
      if (name === "NotAllowedError") toast("Press play to start the music", { id: "player-autoplay" })
      else toast.error("Playback failed", { description: String((error as Error).message ?? error) })
    })
  }, [ensureGraph])

  const load = React.useCallback(
    (next: SongSummary, options: { readonly autoplay: boolean; readonly startTime?: number }) => {
      const audio = audioRef.current
      if (!audio) return false
      if (!next.audioUrl) {
        toast.error(`“${next.title}” is not playable yet`, { description: "Its audio has not been downloaded." })
        return false
      }
      pendingSeek.current = options.startTime && options.startTime > 0 ? options.startTime : null
      setSong(next)
      setDetail((d) => (d?.id === next.id ? d : null))
      setDuration(next.duration ?? 0)
      timeStore.set(options.startTime ?? 0)
      audio.preload = "auto"
      audio.src = next.audioUrl
      audio.load()
      if (options.autoplay) startPlayback()
      return true
    },
    [startPlayback, timeStore],
  )

  const resolveQueue = (target: SongSummary, given: ReadonlyArray<SongSummary> | undefined) => {
    const current = latest.current.queue
    if (given && given.length > 0) return given.some((s) => s.id === target.id) ? given : [target, ...given]
    if (current.some((s) => s.id === target.id)) return current
    return [target]
  }

  const play = React.useCallback(
    (target: SongSummary, given?: ReadonlyArray<SongSummary>) => {
      const audio = audioRef.current
      setQueue(resolveQueue(target, given))
      if (latest.current.song?.id === target.id && audio?.src) {
        startPlayback()
        return
      }
      load(target, { autoplay: true })
    },
    [load, startPlayback],
  )

  const playAt = React.useCallback(
    (target: SongSummary, time: number, given?: ReadonlyArray<SongSummary>) => {
      const audio = audioRef.current
      setQueue(resolveQueue(target, given))
      if (latest.current.song?.id === target.id && audio?.src) {
        audio.currentTime = Math.max(0, time)
        timeStore.set(audio.currentTime)
        startPlayback()
        return
      }
      load(target, { autoplay: true, startTime: time })
    },
    [load, startPlayback, timeStore],
  )

  const pause = React.useCallback(() => audioRef.current?.pause(), [])
  const resume = React.useCallback(() => startPlayback(), [startPlayback])
  const toggle = React.useCallback(() => {
    const audio = audioRef.current
    if (!audio?.src) return
    if (audio.paused) startPlayback()
    else audio.pause()
  }, [startPlayback])

  const seek = React.useCallback(
    (time: number) => {
      const audio = audioRef.current
      if (!audio?.src || !Number.isFinite(time)) return
      const max = Number.isFinite(audio.duration) ? audio.duration : Infinity
      const t = Math.min(Math.max(0, time), Math.max(0, max - 0.05))
      if (audio.readyState === 0) pendingSeek.current = t
      else audio.currentTime = t
      timeStore.set(t)
    },
    [timeStore],
  )

  const next = React.useCallback(() => {
    const { song: s, queue: q } = latest.current
    const i = s ? q.findIndex((x) => x.id === s.id) : -1
    // Skip songs without audio.
    for (let j = i + 1; j < q.length; j++) {
      if (q[j]!.audioUrl) {
        load(q[j]!, { autoplay: true })
        return
      }
    }
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      timeStore.set(0)
    }
  }, [load, timeStore])

  const prev = React.useCallback(() => {
    const audio = audioRef.current
    const { song: s, queue: q } = latest.current
    if (audio && audio.currentTime > 3) {
      seek(0)
      return
    }
    const i = s ? q.findIndex((x) => x.id === s.id) : -1
    for (let j = i - 1; j >= 0; j--) {
      if (q[j]!.audioUrl) {
        load(q[j]!, { autoplay: !audio?.paused })
        return
      }
    }
    seek(0)
  }, [load, seek])

  const setVolume = React.useCallback(
    (v: number) => {
      const value = clamp01(v)
      setVolumeState(value)
      setMuted(false)
      applyVolume(value, false)
    },
    [applyVolume],
  )

  const toggleMute = React.useCallback(() => {
    setMuted((m) => {
      applyVolume(latest.current.volume, !m)
      return !m
    })
  }, [applyVolume])

  const enqueue = React.useCallback((target: SongSummary, options?: { readonly next?: boolean }) => {
    setQueue((q) => {
      const without = q.filter((s) => s.id !== target.id)
      const current = latest.current.song
      if (!options?.next || !current) return [...without, target]
      const i = without.findIndex((s) => s.id === current.id)
      return [...without.slice(0, i + 1), target, ...without.slice(i + 1)]
    })
    toast(`Added “${target.title}” to the queue`, { id: `queued-${target.id}` })
  }, [])

  const removeFromQueue = React.useCallback((index: number) => {
    setQueue((q) => {
      const target = q[index]
      if (!target || target.id === latest.current.song?.id) return q
      return q.filter((_, i) => i !== index)
    })
  }, [])

  const clearQueue = React.useCallback(() => {
    const s = latest.current.song
    setQueue(s ? [s] : [])
  }, [])

  // ---- Music video -------------------------------------------------------
  const openVideo = React.useCallback(
    (options?: OpenVideoOptions) => {
      const audio = audioRef.current
      const current = latest.current.song
      let target = current
      let songTime = options?.songTime
      if (options?.song && options.song.id !== current?.id) {
        target = options.song
        setQueue(resolveQueue(options.song, undefined))
        load(options.song, { autoplay: false, startTime: options.songTime ?? 0 })
        songTime = options.songTime ?? (options.videoTime === undefined ? 0 : undefined)
      } else if (songTime === undefined && options?.videoTime === undefined) {
        songTime = audio?.currentTime ?? 0
      }
      if (!target) return
      const wasPlaying = Boolean(audio && !audio.paused && target.id === current?.id)
      audio?.pause()
      nonce.current += 1
      setVideoRequest({
        song: target,
        ...(songTime !== undefined ? { songTime } : {}),
        ...(options?.videoTime !== undefined ? { videoTime: options.videoTime } : {}),
        wasPlaying,
        nonce: nonce.current,
      })
      setVideoOpen(true)
    },
    [load],
  )

  const closeVideo = React.useCallback(() => setVideoOpen(false), [])

  const setPlaybackFromVideo = React.useCallback(
    (songTime: number, resumePlayback: boolean) => {
      seek(songTime)
      if (resumePlayback) startPlayback()
      else audioRef.current?.pause()
    },
    [seek, startPlayback],
  )

  const setVideoClock = React.useCallback(
    (songTime: number | null) => {
      videoClock.current = songTime !== null && Number.isFinite(songTime) ? Math.max(0, songTime) : null
      timeStore.set(videoClock.current ?? audioRef.current?.currentTime ?? timeStore.get())
    },
    [timeStore],
  )

  const getCurrentTime = React.useCallback(
    () => videoClock.current ?? audioRef.current?.currentTime ?? timeStore.get(),
    [timeStore],
  )
  const getAudioElement = React.useCallback(() => audioRef.current, [])

  // ---- Audio element + events (mount once) ------------------------------
  React.useEffect(() => {
    const audio = new Audio()
    audio.preload = "auto"
    audioRef.current = audio
    let raf = 0
    let lastPersist = 0

    const tick = () => {
      timeStore.set(audio.currentTime)
      raf = requestAnimationFrame(tick)
    }
    const stopTick = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const onPlay = () => {
      setIsPlaying(true)
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const onPause = () => {
      setIsPlaying(false)
      stopTick()
      timeStore.set(audio.currentTime)
      persist()
    }
    const onTimeUpdate = () => {
      // Also covers throttled/background tabs where rAF does not fire.
      timeStore.set(audio.currentTime)
      const now = Date.now()
      if (now - lastPersist > 5000) {
        lastPersist = now
        persist()
      }
    }
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
      if (pendingSeek.current !== null) {
        audio.currentTime = Math.min(pendingSeek.current, Math.max(0, audio.duration - 0.05))
        pendingSeek.current = null
      }
      timeStore.set(audio.currentTime)
    }
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const onWaiting = () => setIsLoading(true)
    const onPlaying = () => setIsLoading(false)
    const onCanPlay = () => setIsLoading(false)
    const onLoadStart = () => setIsLoading(true)
    const onEnded = () => next()
    const onError = () => {
      setIsPlaying(false)
      setIsLoading(false)
      stopTick()
      const s = latest.current.song
      if (!audio.src || !s) return
      toast.error(`Couldn’t play “${s.title}”`, {
        id: `player-error-${s.id}`,
        description: audio.error?.message || "The audio file is missing or unreadable.",
      })
    }
    const onSeeked = () => timeStore.set(audio.currentTime)

    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("waiting", onWaiting)
    audio.addEventListener("playing", onPlaying)
    audio.addEventListener("canplay", onCanPlay)
    audio.addEventListener("loadstart", onLoadStart)
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("error", onError)
    audio.addEventListener("seeked", onSeeked)

    const onPageHide = () => persist()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist()
    }
    window.addEventListener("pagehide", onPageHide)
    document.addEventListener("visibilitychange", onVisibility)

    // Resume the last session (paused — browsers block autoplay anyway).
    const saved = readPersistedPlayer()
    if (saved) {
      const stub = songFromPersisted(saved)
      setVolumeState(saved.volume)
      audio.volume = saved.volume
      setSong(stub)
      setQueue([stub])
      pendingSeek.current = saved.time > 0 ? saved.time : null
      timeStore.set(saved.time)
      audio.preload = "metadata"
      audio.src = saved.audioUrl
      const ids = saved.queue.includes(saved.songId) ? saved.queue : [saved.songId, ...saved.queue]
      fetchSongsByIds(ids)
        .then((songs) => {
          if (songs.length === 0) return
          const fresh = songs.find((s) => s.id === saved.songId)
          // A deep link (e.g. /songs/x?t=…) may have started another song while this
          // fetch was in flight: only restore the saved queue if the restored song is
          // still the current one.
          setSong((cur) => {
            if (cur?.id !== saved.songId) return cur
            setQueue(songs)
            return fresh ?? cur
          })
        })
        .catch(() => undefined)
    }

    return () => {
      stopTick()
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("waiting", onWaiting)
      audio.removeEventListener("playing", onPlaying)
      audio.removeEventListener("canplay", onCanPlay)
      audio.removeEventListener("loadstart", onLoadStart)
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("error", onError)
      audio.removeEventListener("seeked", onSeeked)
      window.removeEventListener("pagehide", onPageHide)
      document.removeEventListener("visibilitychange", onVisibility)
      void graphRef.current?.ctx.close().catch(() => undefined)
      graphRef.current = null
      audioRef.current = null
    }
    // `next` and `persist` read refs; registering once is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on song / queue / volume changes.
  React.useEffect(() => {
    if (song) persist()
  }, [song, queue, volume, persist])

  // ---- Analysis + detail for the current song ---------------------------
  const songId = song?.id ?? null
  React.useEffect(() => {
    setAnalysis(null)
    if (!songId) return
    const ctrl = new AbortController()
    fetchSongAnalysis(songId, ctrl.signal)
      .then((a) => {
        if (!ctrl.signal.aborted) setAnalysis(a)
      })
      .catch(() => undefined)
    fetchSong(songId, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted || !d) return
        setDetail(d)
        // Upgrade a stub restored from localStorage with the real summary fields.
        setSong((cur) => (cur && cur.id === d.id && cur.gameId === "" ? { ...cur, ...d } : cur))
      })
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [songId])

  // ---- Media Session (OS media keys, lock screen) ------------------------
  React.useEffect(() => {
    if (!("mediaSession" in navigator) || !song) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.displayArtist,
        album: detail?.album ?? "Riot Games Music Archive",
        artwork: song.coverUrl
          ? [{ src: new URL(song.coverUrl, window.location.origin).href, sizes: "512x512" }]
          : [],
      })
    } catch {
      // MediaMetadata unsupported
    }
  }, [song, detail?.album])

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // action unsupported in this browser
      }
    }
    set("play", () => startPlayback())
    set("pause", () => audioRef.current?.pause())
    set("previoustrack", () => prev())
    set("nexttrack", () => next())
    set("seekto", (d) => {
      if (d.seekTime !== undefined) seek(d.seekTime)
    })
    set("seekbackward", (d) => seek((audioRef.current?.currentTime ?? 0) - (d.seekOffset ?? 10)))
    set("seekforward", (d) => seek((audioRef.current?.currentTime ?? 0) + (d.seekOffset ?? 10)))
    return () => {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as const)
        set(a, null)
    }
  }, [startPlayback, prev, next, seek])

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return
    navigator.mediaSession.playbackState = song ? (isPlaying ? "playing" : "paused") : "none"
    const audio = audioRef.current
    if (audio && duration > 0 && Number.isFinite(duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: audio.playbackRate,
          position: Math.min(duration, audio.currentTime),
        })
      } catch {
        // invalid state while loading
      }
    }
  }, [song, isPlaying, duration])

  // ---- Keyboard: Space toggles playback when nothing interactive has focus.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && t !== document.body && t.closest("input, textarea, select, button, a, [role=slider], [contenteditable=true], [role=dialog]")) return
      if (!audioRef.current?.src) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])

  const value = React.useMemo<PlayerContextValue>(
    () => ({
      song,
      detail,
      queue,
      queueIndex,
      isPlaying,
      isLoading,
      duration,
      volume,
      muted,
      analyser,
      analysis,
      videoOpen,
      videoRequest,
      play,
      playAt,
      toggle,
      pause,
      resume,
      seek,
      next,
      prev,
      setVolume,
      toggleMute,
      enqueue,
      removeFromQueue,
      clearQueue,
      openVideo,
      closeVideo,
      setPlaybackFromVideo,
      setVideoClock,
      getCurrentTime,
      getAudioElement,
      subscribeTime: timeStore.subscribe,
    }),
    [
      song,
      detail,
      queue,
      queueIndex,
      isPlaying,
      isLoading,
      duration,
      volume,
      muted,
      analyser,
      analysis,
      videoOpen,
      videoRequest,
      play,
      playAt,
      toggle,
      pause,
      resume,
      seek,
      next,
      prev,
      setVolume,
      toggleMute,
      enqueue,
      removeFromQueue,
      clearQueue,
      openVideo,
      closeVideo,
      setPlaybackFromVideo,
      setVideoClock,
      getCurrentTime,
      getAudioElement,
      timeStore,
    ],
  )

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <MusicVideoDialog />
    </PlayerContext.Provider>
  )
}
