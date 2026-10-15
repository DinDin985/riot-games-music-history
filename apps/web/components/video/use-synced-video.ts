"use client"

import * as React from "react"
import type { PlayerContextValue, VideoRequest } from "@/components/player/player-provider"
import {
  driftDecision,
  handBackPoint,
  lockTarget,
  songClockAt,
  spanAt,
  startPoint,
  stepVideoBySong,
  updateSeekLead,
  videoOnlySpans,
  type Span,
  type StartPoint,
  type SyncMap,
} from "@/lib/video-sync"
import { formatDuration } from "@workspace/ui/components/riot/format"

/**
 * The engine of the music-video popup: wires a `<video>` element to the global
 * player through the pure timing functions in `lib/video-sync.ts`.
 *
 * - "handoff" (default): the song is paused and the video plays with its own
 *   audio from the same musical moment; every frame the player's clock is set
 *   to the matching song time (`setVideoClock`) so scrubbers and waveforms keep
 *   tracking; `handBack()` continues the song where the video is.
 * - "lock": the song keeps playing and the muted video follows it each frame
 *   (playbackRate nudges for small drift, hard seeks above 250 ms or at cuts).
 *   Parts of the song the video cut show a backdrop instead.
 */

export type VideoMode = "handoff" | "lock"
export type VideoPhase =
  /** Waiting for song data / video metadata. */
  | "loading"
  | "ready"
  /** The browser refused to autoplay with sound — needs a click. */
  | "blocked"
  /** Hand-off: the video reached its end. */
  | "ended"
  | "error"

export type LockState =
  { readonly kind: "play" } | { readonly kind: "gap"; readonly resumeSongTime: number } | { readonly kind: "ended" }

export interface SyncedVideoView {
  readonly songTime: number
  readonly videoTime: number
  /** Matched segment playing now (null during video-only material / song cuts). */
  readonly segment: number | null
}

export interface SyncNotice {
  readonly id: number
  readonly text: string
}

export interface SyncedVideo {
  readonly mode: VideoMode
  readonly phase: VideoPhase
  readonly buffering: boolean
  /** Hand-off: the video is playing; lock: the song is playing. */
  readonly playing: boolean
  readonly view: SyncedVideoView
  /** Hand-off: the video-only scene being shown (null otherwise). */
  readonly exclusive: Span | null
  readonly lockState: LockState
  readonly notice: SyncNotice | null
  readonly setLocked: (lock: boolean) => void
  readonly toggle: () => void
  /** ±seconds in song terms. */
  readonly stepSong: (delta: number) => void
  readonly seekSong: (songTime: number) => void
  readonly seekVideo: (videoTime: number) => void
  readonly replay: () => void
  /** Start playback after an autoplay refusal. */
  readonly start: () => void
  /** Give the song back to the player (continue where the video is). Idempotent. */
  readonly handBack: () => void
  /** Stop driving the player without handing the song back (the player moved on to another song). */
  readonly detach: () => void
  /** Event handlers to spread on the `<video>` element. */
  readonly videoProps: Pick<
    React.ComponentProps<"video">,
    "onWaiting" | "onSeeking" | "onPlaying" | "onSeeked" | "onCanPlay" | "onPlay" | "onPause" | "onEnded" | "onError"
  >
}

interface Options {
  readonly player: PlayerContextValue
  readonly request: VideoRequest
  /** Null until the song data and the video metadata are loaded. */
  readonly sync: SyncMap | null
  readonly videoRef: React.RefObject<HTMLVideoElement | null>
  readonly initialLock: boolean
  readonly onLockChange?: (lock: boolean) => void
  /**
   * The song could not be loaded into the player (e.g. its audio is missing):
   * play the video on its own — no clock driving, no hand-back, no lock mode.
   */
  readonly standalone?: boolean
}

const VIEW_INTERVAL_MS = 100
const NOTICE_MS = 5000
const BUFFERING_DELAY_MS = 220

const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === "AbortError"
const isNotAllowed = (error: unknown) => (error as { name?: string } | null)?.name === "NotAllowedError"

export function useSyncedVideo({
  player,
  request,
  sync,
  videoRef,
  initialLock,
  onLockChange,
  standalone = false,
}: Options): SyncedVideo {
  const [mode, setMode] = React.useState<VideoMode>(initialLock ? "lock" : "handoff")
  const [phase, setPhase] = React.useState<VideoPhase>("loading")
  const [buffering, setBuffering] = React.useState(false)
  const [videoPlaying, setVideoPlaying] = React.useState(false)
  const [view, setView] = React.useState<SyncedVideoView>({
    songTime: request.songTime ?? 0,
    videoTime: request.videoTime ?? 0,
    segment: null,
  })
  const [exclusive, setExclusive] = React.useState<Span | null>(null)
  const [lockState, setLockState] = React.useState<LockState>({ kind: "play" })
  const [notice, setNotice] = React.useState<SyncNotice | null>(null)

  // Latest values for the rAF loop and imperative handlers.
  const playerRef = React.useRef(player)
  const syncRef = React.useRef(sync)
  const modeRef = React.useRef(mode)
  const phaseRef = React.useRef(phase)
  const standaloneRef = React.useRef(standalone)
  React.useLayoutEffect(() => {
    standaloneRef.current = standalone
    playerRef.current = player
    syncRef.current = sync
    modeRef.current = mode
    phaseRef.current = phase
  })

  const appliedNonce = React.useRef<number | null>(null)
  const handedBack = React.useRef(false)
  // Lock-mode drift state.
  const lastSegment = React.useRef<number | null>(null)
  const lastSeekAt = React.useRef(Number.NEGATIVE_INFINITY)
  const seekLead = React.useRef(0.08)
  const pendingLead = React.useRef<number | null>(null)

  const noticeId = React.useRef(0)
  const say = React.useCallback((text: string) => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, text })
  }, [])
  React.useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  const spans = React.useMemo(
    () => (sync && sync.quality !== "approximate" ? videoOnlySpans(sync.alignment) : []),
    [sync],
  )

  // ---- Playback helpers ----------------------------------------------------
  const playVideo = React.useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.play().then(
      () => setPhase((p) => (p === "blocked" || p === "ended" ? "ready" : p)),
      (error: unknown) => {
        if (isAbort(error)) return
        if (isNotAllowed(error)) setPhase("blocked")
        else setPhase("error")
      },
    )
  }, [videoRef])

  const announce = React.useCallback(
    (sp: StartPoint, context: "open" | "seek") => {
      if (sp.kind === "snapped" && sp.requestedSongTime !== null) {
        say(
          `${formatDuration(sp.requestedSongTime)} of the song isn't in the music video — picking up where the video resumes it (${formatDuration(sp.songTime)}).`,
        )
      } else if (sp.kind === "restart" && context === "open") {
        say("The music video ends before this part of the song — playing it from the start.")
      }
    },
    [say],
  )

  /** Hand-off: put the video at `sp` and drive the player's clock from it. */
  const handoffTo = React.useCallback(
    (sp: StartPoint, play: boolean) => {
      const v = videoRef.current
      if (!v) return
      v.playbackRate = 1
      v.currentTime = sp.videoTime
      if (!standaloneRef.current) playerRef.current.setVideoClock(sp.songTime)
      setView({ songTime: sp.songTime, videoTime: sp.videoTime, segment: null })
      if (play) playVideo()
    },
    [videoRef, playVideo],
  )

  // ---- Apply the open request (and re-requests while open) -----------------
  React.useEffect(() => {
    const v = videoRef.current
    if (!sync || !v || appliedNonce.current === request.nonce || phaseRef.current === "error") return
    const first = appliedNonce.current === null
    appliedNonce.current = request.nonce
    handedBack.current = false
    const p = playerRef.current
    // An explicit video moment (curated key moment) is shown exactly: hand-off mode.
    const lock =
      !standaloneRef.current && request.videoTime === undefined && (first ? initialLock : modeRef.current === "lock")
    if (lock) {
      v.muted = true
      p.setVideoClock(null)
      lastSegment.current = null
      p.setPlaybackFromVideo(request.songTime ?? 0, true)
      setMode("lock")
      setPhase("ready")
      return
    }
    if (modeRef.current === "lock") p.pause()
    setMode("handoff")
    v.muted = p.muted
    v.volume = p.volume
    const sp = startPoint(sync.alignment, request)
    handoffTo(sp, true)
    announce(sp, "open")
    setPhase((ph) => (ph === "loading" || ph === "ended" ? "ready" : ph))
    // `initialLock` only matters for the first request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, request, handoffTo, announce, say, videoRef])

  // ---- Volume follows the player in hand-off; the video is muted when locked.
  React.useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = Math.min(1, Math.max(0, player.volume))
    v.muted = mode === "lock" || player.muted
  }, [player.volume, player.muted, mode, videoRef, phase])

  // ---- <video> events (spread `videoProps` on the element) -------------------
  const bufferTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (bufferTimer.current) clearTimeout(bufferTimer.current)
    },
    [],
  )
  const videoProps = React.useMemo(() => {
    const busy = () => {
      if (bufferTimer.current) return
      bufferTimer.current = setTimeout(() => {
        bufferTimer.current = null
        setBuffering(true)
      }, BUFFERING_DELAY_MS)
    }
    const idle = () => {
      if (bufferTimer.current) clearTimeout(bufferTimer.current)
      bufferTimer.current = null
      setBuffering(false)
    }
    return {
      onWaiting: busy,
      onSeeking: busy,
      onPlaying: idle,
      onSeeked: idle,
      onCanPlay: idle,
      onPlay: () => setVideoPlaying(true),
      onPause: () => setVideoPlaying(false),
      onEnded: () => {
        setVideoPlaying(false)
        if (modeRef.current === "handoff") setPhase("ended")
      },
      onError: () => {
        idle()
        setPhase("error")
      },
    } satisfies React.ComponentProps<"video">
  }, [])

  // ---- The frame loop -------------------------------------------------------
  React.useEffect(() => {
    if (!sync) return
    let raf = 0
    let lastViewAt = 0
    let lastExclusive: Span | null = null
    let lastLock: LockState = { kind: "play" }

    const sameLock = (a: LockState, b: LockState) =>
      a.kind === b.kind && (a.kind !== "gap" || (b.kind === "gap" && a.resumeSongTime === b.resumeSongTime))

    let lastStepAt = Number.NEGATIVE_INFINITY

    const step = (now: number) => {
      lastStepAt = now
      const v = videoRef.current
      const s = syncRef.current
      if (!v || !s || appliedNonce.current === null || handedBack.current || phaseRef.current === "error") return
      const p = playerRef.current
      const alignment = s.alignment
      let songTime: number
      let segment: number | null

      if (modeRef.current === "handoff") {
        const clock = songClockAt(alignment, v.currentTime)
        songTime = clock.songTime
        segment = clock.segmentIndex
        if (!standaloneRef.current) p.setVideoClock(songTime)
        const ex = spanAt(spans, v.currentTime)
        if (ex?.start !== lastExclusive?.start) {
          lastExclusive = ex
          setExclusive(ex)
        }
      } else {
        if (lastExclusive) {
          lastExclusive = null
          setExclusive(null)
        }
        const audio = p.getAudioElement()
        songTime = p.getCurrentTime()
        const songPlaying = Boolean(audio && !audio.paused && !audio.seeking && audio.readyState >= 3)
        const target = lockTarget(alignment, songTime)
        let lockNow: LockState
        if (target.kind === "play") {
          segment = target.segmentIndex
          const segmentChanged = lastSegment.current !== null && lastSegment.current !== target.segmentIndex
          lastSegment.current = target.segmentIndex
          if (!v.seeking) {
            // Learn the seek latency from the first frame after a seek completes.
            if (pendingLead.current !== null) {
              if (songPlaying)
                seekLead.current = updateSeekLead(
                  seekLead.current,
                  pendingLead.current + (target.videoTime - v.currentTime),
                )
              pendingLead.current = null
            }
            const d = driftDecision({
              target: target.videoTime,
              actual: v.currentTime,
              playing: songPlaying,
              rate: v.playbackRate,
              segmentChanged,
              msSinceSeek: now - lastSeekAt.current,
              lead: seekLead.current,
            })
            if (d.kind === "seek") {
              v.playbackRate = 1
              v.currentTime = Math.min(d.to, Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.05) : d.to)
              lastSeekAt.current = now
              pendingLead.current = songPlaying ? seekLead.current : null
            } else if (Math.abs(v.playbackRate - d.rate) > 1e-3) {
              v.playbackRate = d.rate
            }
          }
          if (songPlaying && v.paused && !v.ended) v.play().catch(() => undefined)
          else if (!songPlaying && !v.paused) v.pause()
          lockNow = { kind: "play" }
        } else if (target.kind === "gap") {
          segment = null
          // Wait on the frame where the video picks the song back up.
          lastSegment.current = target.segmentIndex
          if (!v.paused) v.pause()
          if (v.playbackRate !== 1) v.playbackRate = 1
          if (!v.seeking && Math.abs(v.currentTime - target.resumeVideoTime) > 0.05)
            v.currentTime = target.resumeVideoTime
          lockNow = { kind: "gap", resumeSongTime: target.resumeSongTime }
        } else {
          segment = null
          lastSegment.current = null
          if (!v.paused) v.pause()
          lockNow = { kind: "ended" }
        }
        if (!sameLock(lockNow, lastLock)) {
          lastLock = lockNow
          setLockState(lockNow)
        }
      }

      if (now - lastViewAt >= VIEW_INTERVAL_MS) {
        lastViewAt = now
        const videoTime = v.currentTime
        setView((prev) =>
          prev.songTime === songTime && prev.videoTime === videoTime && prev.segment === segment
            ? prev
            : { songTime, videoTime, segment },
        )
      }
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      step(now)
    }
    raf = requestAnimationFrame(frame)
    // rAF stops in background tabs (and hidden panes): keep the clock / slaving going on a timer.
    const fallback = setInterval(() => {
      const now = performance.now()
      if (now - lastStepAt > 200) step(now)
    }, 250)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(fallback)
    }
  }, [sync, spans, videoRef])

  // Whatever happens, never leave the player's clock pointing at a video that is gone.
  React.useEffect(
    () => () => {
      if (!standaloneRef.current) playerRef.current.setVideoClock(null)
    },
    [],
  )

  // ---- Mode switch ------------------------------------------------------------
  const setLocked = React.useCallback(
    (lock: boolean) => {
      const v = videoRef.current
      const s = syncRef.current
      const p = playerRef.current
      if (standaloneRef.current) return
      onLockChange?.(lock)
      if (!v || !s || appliedNonce.current === null) {
        setMode(lock ? "lock" : "handoff")
        return
      }
      if (lock === (modeRef.current === "lock")) return
      if (lock) {
        const hb = handBackPoint(s.alignment, v.currentTime)
        const wasPlaying = !v.paused && !v.ended
        v.muted = true
        lastSegment.current = null
        lastSeekAt.current = Number.NEGATIVE_INFINITY
        p.setVideoClock(null)
        p.setPlaybackFromVideo(hb.songTime, wasPlaying && !hb.atEnd)
        setMode("lock")
        if (phaseRef.current === "ended" || phaseRef.current === "blocked") setPhase("ready")
      } else {
        const audio = p.getAudioElement()
        const wasPlaying = Boolean(audio && !audio.paused)
        const songTime = p.getCurrentTime()
        p.pause()
        v.muted = p.muted
        setMode("handoff")
        const sp = startPoint(s.alignment, { songTime })
        handoffTo(sp, wasPlaying)
        announce(sp, "open")
      }
    },
    [videoRef, onLockChange, handoffTo, announce],
  )

  // ---- Transport ----------------------------------------------------------------
  const toggle = React.useCallback(() => {
    const v = videoRef.current
    const p = playerRef.current
    if (!v || appliedNonce.current === null) return
    if (modeRef.current === "lock") {
      p.toggle()
      return
    }
    if (phaseRef.current === "ended") {
      v.currentTime = 0
      playVideo()
      return
    }
    if (v.paused) playVideo()
    else v.pause()
  }, [videoRef, playVideo])

  const seekSong = React.useCallback(
    (songTime: number) => {
      const v = videoRef.current
      const s = syncRef.current
      const p = playerRef.current
      if (!v || !s || appliedNonce.current === null) return
      if (modeRef.current === "lock") {
        p.seek(songTime)
        return
      }
      let sp = startPoint(s.alignment, { songTime })
      if (sp.kind === "restart") {
        // Seeking past everything the video has: park at its last matched moment instead of restarting.
        const last = s.alignment.segments[s.alignment.segments.length - 1]
        const at = Math.max(
          0,
          Math.min(last?.videoEnd ?? 0, (Number.isFinite(v.duration) ? v.duration : Infinity) - 0.1),
        )
        sp = {
          kind: "snapped",
          videoTime: at,
          songTime: songClockAt(s.alignment, at).songTime,
          requestedSongTime: songTime,
        }
        say("This part of the song isn't in the music video.")
      } else {
        announce(sp, "seek")
      }
      const resume = !v.paused || phaseRef.current === "ended"
      handoffTo(sp, resume)
    },
    [videoRef, handoffTo, announce, say],
  )

  const seekVideo = React.useCallback(
    (videoTime: number) => {
      const v = videoRef.current
      const s = syncRef.current
      const p = playerRef.current
      if (!v || !s || appliedNonce.current === null) return
      if (modeRef.current === "lock") {
        p.seek(handBackPoint(s.alignment, videoTime).songTime)
        return
      }
      const resume = !v.paused || phaseRef.current === "ended"
      handoffTo(startPoint(s.alignment, { videoTime }), resume)
    },
    [videoRef, handoffTo],
  )

  const stepSong = React.useCallback(
    (delta: number) => {
      const v = videoRef.current
      const s = syncRef.current
      const p = playerRef.current
      if (!v || !s || appliedNonce.current === null) return
      if (modeRef.current === "lock") {
        p.seek(p.getCurrentTime() + delta)
        return
      }
      const resume = !v.paused || phaseRef.current === "ended"
      handoffTo(
        startPoint(s.alignment, {
          videoTime: stepVideoBySong(s.alignment, v.currentTime, delta),
        }),
        resume,
      )
    },
    [videoRef, handoffTo],
  )

  const replay = React.useCallback(() => {
    const s = syncRef.current
    if (!s) return
    if (modeRef.current === "lock") {
      playerRef.current.setPlaybackFromVideo(0, true)
      return
    }
    handoffTo(startPoint(s.alignment, { videoTime: 0 }), true)
  }, [handoffTo])

  const start = React.useCallback(() => {
    if (modeRef.current === "lock") playerRef.current.resume()
    else playVideo()
  }, [playVideo])

  const handBack = React.useCallback(() => {
    if (handedBack.current) return
    handedBack.current = true
    const v = videoRef.current
    const s = syncRef.current
    const p = playerRef.current
    if (standaloneRef.current) {
      v?.pause()
      return
    }
    p.setVideoClock(null)
    if (modeRef.current === "lock") {
      v?.pause()
      return
    }
    if (v && s && appliedNonce.current !== null && phaseRef.current !== "error") {
      const hb = handBackPoint(s.alignment, v.currentTime)
      // Autoplay was refused: the video never really started — keep the song's previous play state.
      const resume = phaseRef.current === "blocked" ? request.wasPlaying : !v.paused && !v.ended && !hb.atEnd
      v.pause()
      p.setPlaybackFromVideo(hb.songTime, resume)
      return
    }
    // The video never started: leave the song as it was.
    v?.pause()
    if (request.wasPlaying) p.resume()
  }, [videoRef, request.wasPlaying])

  const detach = React.useCallback(() => {
    handedBack.current = true
    if (!standaloneRef.current) playerRef.current.setVideoClock(null)
    videoRef.current?.pause()
  }, [videoRef])

  return {
    mode,
    phase,
    buffering,
    playing: mode === "lock" ? player.isPlaying : videoPlaying,
    view,
    exclusive: mode === "handoff" ? exclusive : null,
    lockState,
    notice,
    setLocked,
    toggle,
    stepSong,
    seekSong,
    seekVideo,
    replay,
    start,
    handBack,
    detach,
    videoProps,
  }
}
