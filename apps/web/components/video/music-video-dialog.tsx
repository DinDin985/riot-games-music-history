"use client"

import * as React from "react"
import Link from "next/link"
import {
  ExternalLinkIcon,
  InfoIcon,
  Link2Icon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react"
import type { Alignment } from "@workspace/db/domain/alignment"
import { youtubeUrl } from "@workspace/db/domain/media"
import type { SongDetail } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Kbd } from "@workspace/ui/components/kbd"
import { Label } from "@workspace/ui/components/label"
import { Slider } from "@workspace/ui/components/slider"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer, type VideoRequest } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"
import { fetchSong, fetchSongAlignment } from "@/lib/api-client"
import { resolveSync } from "@/lib/video-sync"
import { useSyncedVideo, type SyncedVideo } from "@/components/video/use-synced-video"
import { useWatchDeepLink } from "@/components/video/use-watch-deep-link"

/**
 * The synced music-video popup — rendered once inside <PlayerProvider>.
 *
 * "Watch music video" (`openVideo()`) opens a large dialog with the song's MV
 * at the SAME MUSICAL MOMENT the song is at, mapped through the stored audio
 * alignment (`/api/songs/:id/alignment`) — see `lib/video-sync.ts` and
 * `use-synced-video.ts` for the two modes (hand-off / lock to track).
 */

interface SessionHandle {
  readonly handBack: () => void
}

const LOCK_PREF_KEY = "riot-music-archive:mv-lock"

function readLockPref(): boolean {
  try {
    return window.localStorage.getItem(LOCK_PREF_KEY) === "1"
  } catch {
    return false
  }
}

function writeLockPref(lock: boolean) {
  try {
    window.localStorage.setItem(LOCK_PREF_KEY, lock ? "1" : "0")
  } catch {
    // storage unavailable: the toggle still works for this session
  }
}

export function MusicVideoDialog() {
  const { videoOpen, videoRequest, closeVideo } = usePlayer()
  const sessionRef = React.useRef<SessionHandle | null>(null)

  const close = React.useCallback(() => {
    sessionRef.current?.handBack()
    closeVideo()
  }, [closeVideo])

  return (
    <>
      <React.Suspense fallback={null}>
        <WatchDeepLink />
      </React.Suspense>
      <Dialog
        open={videoOpen && videoRequest !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        {videoRequest && (
          <>
            <DialogPortal>
              <DialogOverlay className="bg-navy-950/80 supports-backdrop-filter:backdrop-blur-sm" />
            </DialogPortal>
            <DialogContent
              showCloseButton={false}
              data-music-video=""
              onOpenAutoFocus={(e) => {
                // Focus the stage (not the first button) so Space / arrows control the video right away.
                e.preventDefault()
                const root = e.currentTarget as HTMLElement | null
                root?.querySelector<HTMLElement>("[data-video-stage]")?.focus({ preventScroll: true })
              }}
              className={cn(
                "flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-navy-950 p-0 text-white shadow-2xl ring-0",
                "sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(72rem,calc(100vw-2rem),calc((100dvh-15rem)*1.7778))] sm:max-w-none sm:min-w-[min(36rem,calc(100vw-2rem))] sm:rounded-2xl sm:ring-1 sm:ring-white/10",
              )}
            >
              <MusicVideoSession key={videoRequest.song.id} ref={sessionRef} request={videoRequest} />
            </DialogContent>
          </>
        )}
      </Dialog>
    </>
  )
}

/** `/songs/<id>?watch=1&vt=…` deep links (see use-watch-deep-link.ts). */
function WatchDeepLink() {
  useWatchDeepLink()
  return null
}

// ---------------------------------------------------------------------------

type SessionData =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly detail: SongDetail | null
      readonly alignment: Alignment | null
    }
  | { readonly status: "error"; readonly message: string }

function MusicVideoSession({
  request,
  ref,
}: {
  readonly request: VideoRequest
  readonly ref: React.Ref<SessionHandle>
}) {
  const player = usePlayer()
  const song = request.song
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)

  // ---- Song detail (for the video file) + stored alignment ----------------
  const [data, setData] = React.useState<SessionData>({ status: "loading" })
  const knownDetail = player.detail?.id === song.id ? player.detail : null
  const knownDetailRef = React.useRef(knownDetail)
  React.useEffect(() => {
    const ctrl = new AbortController()
    const known = knownDetailRef.current
    Promise.all([
      known ? Promise.resolve(known) : fetchSong(song.id, ctrl.signal),
      // A failing alignment request degrades to "approximate sync" instead of breaking the popup.
      fetchSongAlignment(song.id, ctrl.signal).catch(() => null),
    ])
      .then(([detail, alignment]) => {
        if (!ctrl.signal.aborted) setData({ status: "ready", detail, alignment })
      })
      .catch((error: unknown) => {
        if (!ctrl.signal.aborted)
          setData({
            status: "error",
            message: String((error as Error)?.message ?? error),
          })
      })
    return () => ctrl.abort()
  }, [song.id])

  const detail = data.status === "ready" ? data.detail : null
  const mv = detail?.musicVideo ?? null
  const videoUrl = mv?.videoUrl ?? null
  const [videoDuration, setVideoDuration] = React.useState<number | null>(null)
  const songDuration =
    (player.song?.id === song.id && player.duration > 0 ? player.duration : null) ??
    song.duration ??
    detail?.duration ??
    null

  const sync = React.useMemo(() => {
    if (data.status !== "ready" || !mv || !videoUrl || videoDuration === null) return null
    const sharesAudio =
      data.detail?.audioKind === "music_video" ||
      (data.detail?.audioVideoId != null && data.detail.audioVideoId === mv.id)
    return resolveSync({
      songId: song.id,
      videoId: mv.id,
      alignment: data.alignment,
      sharesAudio,
      songDuration,
      videoDuration,
    })
  }, [data, mv, videoUrl, videoDuration, songDuration, song.id])

  // openVideo({ song }) loads the song paused; if it could not be loaded (no audio yet) the video plays on its own.
  const [standalone] = React.useState(() => player.song?.id !== song.id)
  const [initialLock] = React.useState(() => !standalone && request.videoTime === undefined && readLockPref())
  const engine = useSyncedVideo({
    player,
    request,
    sync,
    videoRef,
    initialLock,
    onLockChange: writeLockPref,
    standalone,
  })

  React.useImperativeHandle(ref, () => ({ handBack: engine.handBack }), [engine.handBack])

  // The player moved on to another song (e.g. the next track in lock mode): this video no longer applies.
  const currentSongId = player.song?.id ?? null
  const { closeVideo } = player
  const { detach } = engine
  React.useEffect(() => {
    if (!standalone && currentSongId !== null && currentSongId !== song.id) {
      detach()
      closeVideo()
    }
  }, [standalone, currentSongId, song.id, detach, closeVideo])

  // ---- Fullscreen ---------------------------------------------------------
  const [fullscreen, setFullscreen] = React.useState(false)
  React.useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stageRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggleFullscreen = React.useCallback(() => {
    const stage = stageRef.current
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else if (stage?.requestFullscreen) {
      void stage.requestFullscreen().catch(() => undefined)
    } else {
      // iOS Safari: only the video element itself can go fullscreen.
      ;(
        videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      )?.webkitEnterFullscreen?.()
    }
  }, [])

  // ---- Keyboard: Space, ←/→ (±5 s of song), F, M; Esc is the dialog's ----
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    const inControl = target.closest(
      "button, a, input, textarea, select, [role=switch], [role=slider], [contenteditable=true]",
    )
    switch (e.key) {
      case " ":
      case "Spacebar":
        if (inControl) return
        e.preventDefault()
        if (!e.repeat) engine.toggle()
        return
      case "ArrowLeft":
      case "ArrowRight":
        if (target.closest("[role=slider], input, textarea")) return
        e.preventDefault()
        engine.stepSong(e.key === "ArrowLeft" ? -5 : 5)
        return
      case "f":
      case "F":
        if (target.closest("input, textarea")) return
        e.preventDefault()
        toggleFullscreen()
        return
      case "m":
      case "M":
        if (target.closest("input, textarea")) return
        e.preventDefault()
        player.toggleMute()
        return
    }
  }

  const ready = engine.phase !== "loading" && sync !== null
  const noVideo = data.status === "ready" && !videoUrl
  const totalVideo = videoDuration ?? mv?.duration ?? null
  const artistLine = song.displayArtist

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <SongArtwork
          title={song.title}
          coverUrl={song.coverUrl}
          palette={song.palette}
          seed={song.id}
          className="size-10 shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate font-sans text-sm font-semibold sm:text-base">
            <Link
              href={`/songs/${encodeURIComponent(song.id)}`}
              className="hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {song.title}
            </Link>
          </DialogTitle>
          <DialogDescription className="truncate text-xs text-white/60">
            {artistLine} · Music video
            {engine.mode === "lock" ? " · locked to the track" : ""}
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="icon" aria-label="Close music video" className="text-white/80 hover:text-white">
            <XIcon />
          </Button>
        </DialogClose>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        data-video-stage=""
        tabIndex={-1}
        aria-label={`${song.title} music video. Space plays or pauses, arrow keys skip 5 seconds of the song, F toggles fullscreen.`}
        className="group/stage relative min-h-0 flex-1 bg-black outline-none sm:aspect-video sm:flex-none [&:fullscreen]:aspect-auto"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a")) return
          if (ready && engine.phase === "ready") engine.toggle()
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a")) return
          toggleFullscreen()
        }}
      >
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            poster={mv?.thumbnailUrl ?? undefined}
            className="absolute inset-0 size-full object-contain"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              setVideoDuration(Number.isFinite(d) && d > 0 ? d : (mv?.duration ?? null))
            }}
            {...engine.videoProps}
          />
        )}
        <StageOverlays
          engine={engine}
          ready={ready}
          loading={data.status === "loading" || (!noVideo && !ready && engine.phase !== "error")}
          noVideo={noVideo}
          loadError={data.status === "error" ? data.message : null}
          youtube={mv ? youtubeUrl(mv.id, engine.view.videoTime) : null}
          song={song}
        />
      </div>

      {/* Controls */}
      <div className="space-y-3 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <div className="flex items-center gap-1">
            <Button
              size="icon-lg"
              onClick={engine.toggle}
              disabled={!ready}
              aria-label={engine.playing ? "Pause" : "Play"}
              className="rounded-full bg-white text-navy-900 hover:bg-gold"
            >
              {engine.playing ? (
                <PauseIcon className="fill-current" />
              ) : (
                <PlayIcon className="translate-x-px fill-current" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!ready}
              onClick={() => engine.stepSong(-5)}
              aria-label="Back 5 seconds of the song"
            >
              <RotateCcwIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!ready}
              onClick={() => engine.stepSong(5)}
              aria-label="Forward 5 seconds of the song"
            >
              <RotateCwIcon />
            </Button>
          </div>
          <div className="min-w-0 text-xs tabular-nums">
            <span className="text-white">{formatDuration(engine.view.videoTime)}</span>
            <span className="text-white/50"> / {formatDuration(totalVideo)}</span>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-white/5">
                  <Switch
                    id="mv-lock-to-track"
                    checked={engine.mode === "lock"}
                    onCheckedChange={(checked) => engine.setLocked(checked)}
                    disabled={!ready || standalone}
                    className="data-checked:bg-gold"
                  />
                  <Label htmlFor="mv-lock-to-track" className="cursor-pointer text-xs whitespace-nowrap text-white/80">
                    <Link2Icon className="size-3.5" aria-hidden />
                    Lock to track
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-balance">
                {standalone
                  ? "This song's audio is not in the archive yet, so the video plays on its own."
                  : "Keep listening to the song while the muted video follows it, skipping what the video cut."}
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              onClick={player.toggleMute}
              aria-label={player.muted ? "Unmute" : "Mute"}
              className="text-white/80 hover:text-white"
            >
              {player.muted ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              disabled={!videoUrl}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="text-white/80 hover:text-white"
            >
              {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
          </div>
        </div>

        <Slider
          aria-label="Seek in the music video"
          min={0}
          max={totalVideo ?? 1}
          step={0.1}
          value={[Math.min(engine.view.videoTime, totalVideo ?? 0)]}
          onValueChange={([t]) => t !== undefined && engine.seekVideo(t)}
          disabled={!ready || !totalVideo}
          className="[&_[data-slot=slider-range]]:bg-gold [&_[data-slot=slider-track]]:bg-white/15"
        />

        <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45 md:flex">
          <span className="inline-flex items-center gap-1">
            <Kbd>Space</Kbd> play / pause
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> ±5 s of the song
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>F</Kbd> fullscreen
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>M</Kbd> mute
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> back to the song
          </span>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StageOverlays({
  engine,
  ready,
  loading,
  noVideo,
  loadError,
  youtube,
  song,
}: {
  readonly engine: SyncedVideo
  readonly ready: boolean
  readonly loading: boolean
  readonly noVideo: boolean
  readonly loadError: string | null
  readonly youtube: string | null
  readonly song: VideoRequest["song"]
}) {
  const { phase, mode, lockState, notice, buffering } = engine

  if (noVideo || loadError) {
    return (
      <PaletteBackdrop
        palette={song.palette}
        seed={song.id}
        className="absolute inset-0 flex items-center justify-center p-6 text-center"
      >
        <div className="relative max-w-sm space-y-3">
          <p className="font-display text-3xl tracking-wide">
            {loadError ? "Couldn’t load the video" : "No music video"}
          </p>
          <p className="text-sm text-white/75">
            {loadError ?? "This song’s music video has not been downloaded to the archive."}
          </p>
          {youtube && (
            <Button asChild variant="secondary" size="sm">
              <a href={youtube} target="_blank" rel="noreferrer">
                Watch on YouTube <ExternalLinkIcon data-icon="inline-end" />
              </a>
            </Button>
          )}
        </div>
      </PaletteBackdrop>
    )
  }

  return (
    <>
      {loading && (
        <PaletteBackdrop
          palette={song.palette}
          seed={song.id}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80"
        >
          <Spinner className="relative size-7" />
          <span className="relative text-xs tracking-[0.25em] uppercase">Finding the moment…</span>
        </PaletteBackdrop>
      )}

      {/* Lock to track: this part of the song is not in the video. */}
      {ready && mode === "lock" && lockState.kind !== "play" && (
        <PaletteBackdrop
          palette={song.palette}
          seed={song.id}
          className="absolute inset-0 flex animate-in flex-col items-center justify-center gap-4 px-6 text-center fade-in-0"
        >
          <PlayerWaveform
            variant="hero"
            seekable={false}
            className="relative h-20 w-full max-w-md sm:h-28"
            aria-hidden
          />
          <div className="relative space-y-1">
            <p className="font-display text-2xl tracking-wide sm:text-3xl">Not in the music video</p>
            <p className="text-sm text-white/75">
              {lockState.kind === "gap"
                ? `The video picks the song back up at ${formatDuration(lockState.resumeSongTime)}.`
                : "The music video has ended — the song plays on."}
            </p>
          </div>
        </PaletteBackdrop>
      )}

      {ready && buffering && phase === "ready" && !(mode === "lock" && lockState.kind !== "play") && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/55 p-3 backdrop-blur-sm">
            <Spinner className="size-6 text-white" />
          </span>
        </div>
      )}

      {notice && (
        <div
          key={notice.id}
          role="status"
          className="pointer-events-none absolute inset-x-3 bottom-3 flex animate-in justify-center fade-in-0 slide-in-from-bottom-2"
        >
          <span className="inline-flex max-w-full items-start gap-2 rounded-2xl bg-black/70 px-3 py-2 text-xs text-white/90 ring-1 ring-white/10 backdrop-blur-sm">
            <InfoIcon className="mt-px size-3.5 shrink-0 text-gold" aria-hidden />
            {notice.text}
          </span>
        </div>
      )}

      {phase === "blocked" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Button
            size="lg"
            onClick={engine.start}
            className="h-14 rounded-full bg-white px-7 text-base text-navy-900 hover:bg-gold"
            autoFocus
          >
            <PlayIcon className="fill-current" /> Play music video
          </Button>
        </div>
      )}

      {phase === "ended" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-center backdrop-blur-[2px]">
          <p className="font-display text-3xl tracking-wide">That’s the music video</p>
          <div className="flex gap-2">
            <Button onClick={engine.replay} className="rounded-full bg-white text-navy-900 hover:bg-gold">
              <RotateCcwIcon /> Replay
            </Button>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-full border-white/20 bg-white/5 text-white">
                Back to the song
              </Button>
            </DialogClose>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center">
          <p className="font-display text-3xl tracking-wide">Couldn’t play the video</p>
          <p className="max-w-sm text-sm text-white/70">The video file is missing or unreadable.</p>
          {youtube && (
            <Button asChild variant="secondary" size="sm">
              <a href={youtube} target="_blank" rel="noreferrer">
                Watch on YouTube <ExternalLinkIcon data-icon="inline-end" />
              </a>
            </Button>
          )}
        </div>
      )}
    </>
  )
}
