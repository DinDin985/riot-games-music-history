/**
 * Bottom mini player for the story pages, styled like the Next.js PlayerBar.
 * Plays the page's song (or whatever a card's play button loaded) from
 * `/media`, shows the shared moving waveform, and resumes the Next.js player's
 * last song from localStorage (PLAYER_STORAGE_KEY). Space toggles play/pause.
 */
import { useEffect, useState } from "react"
import { History, ListMusic, Loader2, Pause, Play } from "lucide-react"
import type { PersistedPlayerState } from "@workspace/ui/lib/site-nav"
import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { cn } from "@workspace/ui/lib/utils"
import type { PlayerTrack } from "../../lib/types.ts"
import {
  currentTime,
  getAnalyser,
  player,
  readPersisted,
  trackFromPersisted,
  usePlayer,
  type PlayerState,
} from "./player-store.ts"

export interface MiniPlayerProps {
  /** The page's own song, shown ready-to-play before anything else is loaded. */
  readonly defaultTrack?: PlayerTrack | null
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName) || target.closest("[role=slider]"))

export default function MiniPlayer({ defaultTrack = null }: MiniPlayerProps) {
  const state = usePlayer()
  const [saved, setSaved] = useState<PersistedPlayerState | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // localStorage is only readable after hydration.
  useEffect(() => setSaved(readPersisted()), [])

  // Without a song of its own (the /impact list), the bar offers the archive's last song.
  const savedTrack = saved ? trackFromPersisted(saved) : null
  const idleTrack = defaultTrack ?? savedTrack
  const track = state.track ?? idleTrack
  // Continue from the saved position when the bar shows the song the main app was playing.
  const startAt = !state.track && saved && saved.audioUrl === track?.audioUrl ? saved.time : 0

  const play = () => {
    if (state.track) return player.toggle()
    if (track) player.load(track, { startAt, volume: saved?.volume })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (!track) return
      e.preventDefault()
      play()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // A separate song saved by the main app (e.g. on a story page about another song).
  const resume =
    !dismissed && saved && savedTrack && saved.audioUrl !== track?.audioUrl && saved.time > 1 ? saved : null

  if (!track) return null

  return (
    <>
      <div aria-hidden className={cn("h-[5.5rem] md:h-20", resume && "mt-9")} />
      <section
        aria-label="Player"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a1827]/92 text-foreground shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl supports-backdrop-filter:bg-[#0a1827]/80"
      >
        {resume ? (
          <div className="border-b border-white/[0.06]">
            <div className="mx-auto flex h-9 max-w-[1600px] items-center gap-2 px-3 text-xs md:px-5">
              <History className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span className="hidden truncate text-muted-foreground sm:inline">Continue where you left off:</span>
              <Button
                size="xs"
                variant="ghost"
                className="min-w-0 text-gold hover:bg-white/10 hover:text-gold"
                onClick={() => {
                  player.load(trackFromPersisted(resume), { startAt: resume.time, volume: resume.volume })
                  setDismissed(true)
                }}
              >
                <span className="truncate">
                  Resume {resume.title} at {formatDuration(resume.time)}
                </span>
              </Button>
              <button
                type="button"
                className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        <MobileProgress state={state} track={track} />
        <div className="mx-auto flex h-[5.5rem] max-w-[1600px] items-center gap-3 px-3 md:h-20 md:gap-4 md:px-5">
          {/* Now playing */}
          <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
            <SongArtwork
              title={track.title}
              coverUrl={track.coverUrl}
              palette={track.palette}
              seed={track.songId ?? track.title}
              className="size-12 shrink-0 rounded-md md:size-14"
            />
            <div className="min-w-0">
              {track.songId ? (
                <a
                  href={`/songs/${encodeURIComponent(track.songId)}`}
                  className="block truncate text-sm font-semibold hover:underline"
                >
                  {track.title}
                </a>
              ) : (
                <p className="truncate text-sm font-semibold">{track.title}</p>
              )}
              <p className="truncate text-xs text-muted-foreground">
                {track.displayArtist}
                {!state.track && startAt > 1 ? ` · resume at ${formatDuration(startAt)}` : ""}
              </p>
            </div>
          </div>

          {/* Transport */}
          <div className="flex shrink-0 flex-col items-center gap-1 md:flex-1 md:px-2">
            <Button
              size="icon-lg"
              onClick={play}
              aria-label={state.playing ? "Pause" : `Play ${track.title}`}
              className="size-10 rounded-full bg-white text-[#0c1d2e] hover:scale-105 hover:bg-white"
            >
              {state.loading && !state.playing ? (
                <Loader2 className="size-5 animate-spin" />
              ) : state.playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-px fill-current" />
              )}
            </Button>
            <Scrubber state={state} track={track} className="hidden w-full max-w-xl md:flex" />
          </div>

          {/* Waveform + song page */}
          <div className="flex shrink-0 items-center justify-end gap-1 md:w-[30%] md:gap-2">
            <Waveform
              variant="player"
              peaks={track.peaks}
              peaksRate={track.peaksRate}
              duration={state.duration || track.duration}
              getTime={currentTime}
              playing={state.track !== null && state.playing}
              getAnalyser={getAnalyser}
              seed={track.songId ?? track.title}
              onSeek={state.track ? player.seek : undefined}
              className="hidden h-10 w-28 sm:block lg:w-40 2xl:w-56"
              aria-label="Waveform of the current song"
            />
            {track.songId ? (
              <Button asChild variant="ghost" size="icon" aria-label="Open the song page">
                <a href={`/songs/${encodeURIComponent(track.songId)}`} title="Song page">
                  <ListMusic />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        {state.error ? <p className="pb-2 text-center text-xs text-riot-red">{state.error}</p> : null}
      </section>
    </>
  )
}

function Scrubber({
  state,
  track,
  className,
}: {
  readonly state: PlayerState
  readonly track: PlayerTrack
  readonly className?: string
}) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const active = state.track !== null
  const duration = state.duration || track.duration || 0
  const shown = dragValue ?? (active ? state.time : 0)
  const max = duration > 0 ? duration : 1
  return (
    <div className={cn("items-center gap-2 text-[11px] text-muted-foreground tabular-nums", className)}>
      <span className="w-10 text-right">{formatDuration(shown)}</span>
      <Slider
        aria-label="Seek"
        min={0}
        max={max}
        step={0.1}
        value={[Math.min(shown, max)]}
        onValueChange={([v]) => setDragValue(v ?? 0)}
        onValueCommit={([v]) => {
          player.seek(v ?? 0)
          setDragValue(null)
        }}
        disabled={!active || duration <= 0}
        className="flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:opacity-0 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100"
      />
      <span className="w-10">{formatDuration(duration > 0 ? duration : null)}</span>
    </div>
  )
}

/** Thin progress line on small screens (the full scrubber does not fit). */
function MobileProgress({ state, track }: { readonly state: PlayerState; readonly track: PlayerTrack }) {
  const duration = state.duration || track.duration || 0
  const pct = state.track && duration > 0 ? Math.min(100, (state.time / duration) * 100) : 0
  return (
    <div aria-hidden className="relative h-0.5 bg-white/10 md:hidden">
      <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  )
}
