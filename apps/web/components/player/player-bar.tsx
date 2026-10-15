"use client"

import * as React from "react"
import Link from "next/link"
import {
  ListMusicIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  TvMinimalPlayIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer, useCurrentTime } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"
import { QueueSheet } from "@/components/player/queue-sheet"

/**
 * Persistent bottom player. Renders nothing until a song is loaded, then a
 * fixed bar plus an in-flow spacer of the same height so page content is never
 * hidden behind it.
 */
export function PlayerBar() {
  const player = usePlayer()
  const { song } = player
  if (!song) return null

  return (
    <>
      <div aria-hidden className="h-[5.5rem] md:h-20" />
      <section
        aria-label="Player"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a1827]/92 text-foreground shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl supports-backdrop-filter:bg-[#0a1827]/80"
      >
        <MobileProgress />
        <div className="mx-auto flex h-[5.5rem] max-w-[1600px] items-center gap-3 px-3 md:h-20 md:gap-4 md:px-5">
          <NowPlaying />
          <Transport />
          <Extras />
        </div>
      </section>
    </>
  )
}

function NowPlaying() {
  const { song, detail } = usePlayer()
  if (!song) return null
  const artists = detail?.id === song.id ? detail.artists.filter((a) => a.role === "primary" || a.role === "featured") : []
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
      <Link href={`/songs/${song.id}`} className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <SongArtwork
          title={song.title}
          coverUrl={song.coverUrl}
          palette={song.palette}
          seed={song.id}
          className="size-12 rounded-md md:size-14"
        />
      </Link>
      <div className="min-w-0">
        <Link
          href={`/songs/${song.id}`}
          className="block truncate text-sm font-semibold hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {song.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {artists.length > 0
            ? artists.map((a, i) => (
                <React.Fragment key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/artists/${a.id}`} className="hover:text-foreground hover:underline">
                    {a.name}
                  </Link>
                </React.Fragment>
              ))
            : song.displayArtist}
        </div>
      </div>
    </div>
  )
}

function Transport() {
  const { isPlaying, isLoading, toggle, next, prev, queue, queueIndex } = usePlayer()
  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 md:flex-1 md:px-2">
      <div className="flex items-center gap-1 md:gap-2">
        <Button variant="ghost" size="icon" onClick={prev} aria-label="Previous" className="hidden sm:inline-flex">
          <SkipBackIcon className="fill-current" />
        </Button>
        <Button
          size="icon-lg"
          onClick={toggle}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="size-10 rounded-full bg-white text-[#0c1d2e] hover:scale-105 hover:bg-white"
        >
          {isPlaying && isLoading ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : isPlaying ? (
            <PauseIcon className="size-5 fill-current" />
          ) : (
            <PlayIcon className="size-5 translate-x-px fill-current" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext} aria-label="Next">
          <SkipForwardIcon className="fill-current" />
        </Button>
      </div>
      <Scrubber className="hidden w-full max-w-xl md:flex" />
    </div>
  )
}

function Scrubber({ className }: { readonly className?: string }) {
  const { duration, seek } = usePlayer()
  const time = useCurrentTime(8)
  const [dragValue, setDragValue] = React.useState<number | null>(null)
  const shown = dragValue ?? time
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
          seek(v ?? 0)
          setDragValue(null)
        }}
        disabled={duration <= 0}
        className="flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:opacity-0 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100"
      />
      <span className="w-10">{formatDuration(duration > 0 ? duration : null)}</span>
    </div>
  )
}

/** Thin progress line on small screens (the full scrubber does not fit). */
function MobileProgress() {
  const { duration } = usePlayer()
  const time = useCurrentTime(4)
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-white/10 md:hidden">
      <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Extras() {
  const { song, openVideo, volume, muted, setVolume, toggleMute } = usePlayer()
  const hasVideo = Boolean(song?.hasVideo)
  const VolumeIcon = muted || volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 md:w-[30%] md:gap-2">
      <PlayerWaveform variant="player" className="hidden h-10 w-40 xl:block 2xl:w-56" aria-label="Waveform of the current song — click to seek" />
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={hasVideo ? -1 : 0} className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              disabled={!hasVideo}
              onClick={() => openVideo()}
              aria-label="Watch music video"
              className={cn(hasVideo && "text-gold hover:text-gold")}
            >
              <TvMinimalPlayIcon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {hasVideo ? "Watch the music video from this moment" : "No music video for this song"}
        </TooltipContent>
      </Tooltip>
      <QueueSheet>
        <Button variant="ghost" size="icon" aria-label="Queue">
          <ListMusicIcon />
        </Button>
      </QueueSheet>
      <div className="hidden items-center gap-1 lg:flex">
        <Button variant="ghost" size="icon" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          <VolumeIcon />
        </Button>
        <Slider
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={[muted ? 0 : volume]}
          onValueChange={([v]) => setVolume(v ?? 0)}
          className="w-24 [&_[data-slot=slider-range]]:bg-white"
        />
      </div>
    </div>
  )
}
