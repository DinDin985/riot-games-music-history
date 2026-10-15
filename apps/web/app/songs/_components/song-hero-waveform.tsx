"use client"

import * as React from "react"
import { AudioLinesIcon } from "lucide-react"
import type { SongAnalysis, SongSummary } from "@workspace/db/domain/types"
import { jitter, toPeakBytes } from "@workspace/ui/components/riot/waveform"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { useCurrentTime, usePlayer } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"

/**
 * The song page's big waveform plus a whole-song overview strip.
 *
 * - Big waveform (`PlayerWaveform variant="hero"`): live spectrum while this
 *   song plays; otherwise its precomputed peaks, looping the chorus on a
 *   virtual clock so it moves before anything is played. Click/drag seeks
 *   (or starts the song at that moment).
 * - Overview: the loudness envelope of the entire song as mirrored bars, the
 *   chorus marked in gold, a playhead when this song is loaded. Click or use
 *   the arrow keys to jump.
 */
export function SongHeroWaveform({
  song,
  analysis,
  queue,
}: {
  readonly song: SongSummary
  readonly analysis: SongAnalysis | null
  readonly queue: ReadonlyArray<SongSummary>
}) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id
  const duration = (isCurrent && player.duration) || song.duration || 0

  const seekTo = React.useCallback(
    (t: number) => {
      if (!song.audioUrl) return
      if (player.song?.id === song.id) {
        player.seek(t)
        if (!player.isPlaying) player.resume()
      } else player.playAt(song, t, queue)
    },
    [player, song, queue],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <PlayerWaveform
          variant="hero"
          song={song}
          analysis={analysis}
          preview={!isCurrent}
          dimFuture={isCurrent}
          seekable={Boolean(song.audioUrl)}
          className="h-36 w-full sm:h-48 md:h-60"
          aria-label={`Waveform of ${song.title}${song.audioUrl ? " — click or drag to seek" : ""}`}
        />
        {!isCurrent && analysis?.chorusStart != null && (
          <span className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.25em] text-white/80 uppercase backdrop-blur">
            Chorus preview
          </span>
        )}
      </div>
      <SongOverview song={song} analysis={analysis} duration={duration} isCurrent={isCurrent} onSeek={seekTo} />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Downsample the envelope to `n` bars (max per bucket, normalised to the 98th percentile). */
function overviewLevels(analysis: SongAnalysis | null, duration: number, n: number, seedHash: number): Float32Array | null {
  const bytes = analysis ? toPeakBytes(analysis.peaks) : null
  if (!bytes || bytes.length === 0) return null
  const rate = analysis?.peaksRate || 50
  const span = duration > 0 ? Math.min(bytes.length, Math.ceil(duration * rate)) : bytes.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * span)
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * span))
    let max = 0
    for (let j = a; j < b && j < bytes.length; j++) max = Math.max(max, bytes[j]!)
    out[i] = max
  }
  // Stretch contrast between the quiet floor (10th percentile) and the loud
  // ceiling (98th): loud masters otherwise read as one flat block.
  const sorted = Array.from(out).sort((x, y) => x - y)
  const ref = Math.max(48, sorted[Math.floor(sorted.length * 0.98)] ?? 255)
  const floor = Math.min(ref * 0.6, sorted[Math.floor(sorted.length * 0.1)] ?? 0)
  for (let i = 0; i < n; i++) {
    const level = Math.max(0, (out[i]! - floor) / Math.max(1, ref - floor))
    out[i] = Math.min(1, 0.12 + 0.88 * Math.pow(Math.min(1, level), 1.25) * jitter(seedHash, i, 0.35))
  }
  return out
}

const BARS = 96

function SongOverview({
  song,
  analysis,
  duration,
  isCurrent,
  onSeek,
}: {
  readonly song: SongSummary
  readonly analysis: SongAnalysis | null
  readonly duration: number
  readonly isCurrent: boolean
  readonly onSeek: (t: number) => void
}) {
  const levels = React.useMemo(
    () => overviewLevels(analysis, duration, BARS, [...song.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)),
    [analysis, duration, song.id],
  )
  const [hover, setHover] = React.useState<number | null>(null)
  const now = useCurrentTime(1)
  const seekable = Boolean(song.audioUrl) && duration > 0
  const chorus =
    analysis?.chorusStart != null && duration > 0
      ? {
          left: (analysis.chorusStart / duration) * 100,
          width: (((analysis.chorusEnd ?? analysis.chorusStart + 30) - analysis.chorusStart) / duration) * 100,
        }
      : null

  const timeAt = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return Math.min(duration - 0.1, Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * duration))
  }

  return (
    <div className="flex items-center gap-3">
      <CurrentClock isCurrent={isCurrent} />
      <div
        role={seekable ? "slider" : "img"}
        tabIndex={seekable ? 0 : undefined}
        aria-label={seekable ? `Seek in ${song.title}` : `Overview of ${song.title}`}
        aria-valuemin={seekable ? 0 : undefined}
        aria-valuemax={seekable ? Math.round(duration) : undefined}
        aria-valuenow={seekable ? (isCurrent ? Math.round(now) : 0) : undefined}
        aria-valuetext={seekable ? `${formatDuration(isCurrent ? now : 0)} of ${formatDuration(duration)}` : undefined}
        className={cn(
          "group/overview relative h-12 flex-1 touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60",
          seekable && "cursor-pointer",
        )}
        onPointerMove={(e) => seekable && setHover(timeAt(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => seekable && onSeek(timeAt(e.clientX, e.currentTarget))}
        onKeyDown={(e) => {
          if (!seekable) return
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home") return
          e.preventDefault()
          if (e.key === "Home") return onSeek(0)
          // Not the current song: arrows start from the chorus.
          const base = isCurrent ? now : (analysis?.chorusStart ?? 0)
          onSeek(Math.max(0, base + (e.key === "ArrowRight" ? 10 : -10)))
        }}
      >
        {chorus && (
          <div
            aria-hidden
            title="Chorus"
            className="absolute inset-y-0 rounded-sm bg-gold/10 ring-1 ring-gold/25"
            style={{ left: `${chorus.left}%`, width: `${Math.max(0.5, chorus.width)}%` }}
          />
        )}
        <OverviewBars levels={levels} seed={song.id} isCurrent={isCurrent} duration={duration} />
        {hover !== null && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/50" style={{ left: `${(hover / duration) * 100}%` }} />
            <span
              aria-hidden
              className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#0c1d2e] tabular-nums"
              style={{ left: `${(hover / duration) * 100}%` }}
            >
              {formatDuration(hover)}
            </span>
          </>
        )}
      </div>
      <span className="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDuration(duration || null)}</span>
    </div>
  )
}

/** Bars as one stretched SVG (any width, phone to 4K); re-renders 8×/s only while this song is current. */
function OverviewBars({
  levels,
  seed,
  isCurrent,
  duration,
}: {
  readonly levels: Float32Array | null
  readonly seed: string
  readonly isCurrent: boolean
  readonly duration: number
}) {
  const bars = React.useMemo(() => {
    if (levels) return Array.from(levels)
    // No analysis yet: a flat, quiet line (no invented shape).
    return Array.from({ length: BARS }, (_, i) => 0.08 + 0.04 * Math.sin(i / 3 + seed.length))
  }, [levels, seed])
  return isCurrent ? <PlayedBars bars={bars} duration={duration} /> : <BarsSvg bars={bars} playedUpTo={-1} />
}

const STEP = 4

function BarsSvg({ bars, playedUpTo }: { readonly bars: ReadonlyArray<number>; readonly playedUpTo: number }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${bars.length * STEP} 100`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
    >
      {bars.map((v, i) => {
        const h = Math.max(6, v * 100)
        return (
          <rect
            key={i}
            x={i * STEP + STEP * 0.3}
            y={50 - h / 2}
            width={STEP * 0.4}
            height={h}
            rx={1.4}
            className={cn(
              "transition-[fill-opacity] duration-150",
              playedUpTo < 0 ? "fill-white/45" : i < playedUpTo ? "fill-white" : "fill-white/30",
            )}
          />
        )
      })}
    </svg>
  )
}

function PlayedBars({ bars, duration }: { readonly bars: ReadonlyArray<number>; readonly duration: number }) {
  const time = useCurrentTime(8)
  const fraction = duration > 0 ? Math.min(1, time / duration) : 0
  return (
    <>
      <BarsSvg bars={bars} playedUpTo={fraction * bars.length} />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[-4px] w-0.5 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_12px_rgb(200_155_60/0.8)]"
        style={{ left: `${fraction * 100}%` }}
      />
    </>
  )
}

function CurrentClock({ isCurrent }: { readonly isCurrent: boolean }) {
  return (
    <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs tabular-nums">
      {isCurrent ? <LiveClock /> : <span className="text-muted-foreground">0:00</span>}
    </span>
  )
}

function LiveClock() {
  const { isPlaying } = usePlayer()
  const time = useCurrentTime(2)
  return (
    <>
      {isPlaying && <AudioLinesIcon className="size-3.5 text-gold" aria-hidden />}
      <span className="text-foreground">{formatDuration(time)}</span>
    </>
  )
}
