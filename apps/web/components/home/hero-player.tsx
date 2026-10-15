"use client"

import * as React from "react"
import Link from "next/link"
import { AudioLinesIcon, PauseIcon, PlayIcon, TvMinimalPlayIcon } from "lucide-react"
import type { SongAnalysis, SongSummary } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer, useCurrentTime } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"
import { categoryInfo } from "@/lib/taxonomy"

/**
 * The home hero's big waveform. Follows the player when something is loaded;
 * otherwise previews the featured song (its chorus loops on a virtual clock).
 */
export function HeroWaveform({
  featured,
  analysis,
  queue,
}: {
  readonly featured: SongSummary | null
  readonly analysis: SongAnalysis | null
  readonly queue: ReadonlyArray<SongSummary>
}) {
  const player = usePlayer()
  const following = player.song !== null
  const song = following ? player.song : featured

  return (
    <div className="relative">
      <PlayerWaveform
        variant="hero"
        song={following ? null : featured}
        analysis={following ? null : analysis}
        preview={!following}
        dimFuture={following}
        className="h-40 w-full sm:h-52 md:h-64"
        aria-label={song ? `Waveform of ${song.title}` : "Waveform"}
      />
      {song && (
        <div className="mt-5 flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">
            {following ? (player.isPlaying ? "Now playing" : "Paused") : "Featured"}
            {!following && featured?.primaryCategoryId ? ` · ${categoryInfo(featured.primaryCategoryId).name}` : ""}
          </p>
          <div>
            <Link href={`/songs/${song.id}`} className="font-display text-3xl tracking-wide hover:text-gold md:text-4xl">
              {song.title}
            </Link>
            <p className="text-sm text-muted-foreground">{song.displayArtist}</p>
          </div>
          <HeroControls song={song} queue={queue} following={following} />
        </div>
      )}
    </div>
  )
}

function HeroControls({
  song,
  queue,
  following,
}: {
  readonly song: SongSummary
  readonly queue: ReadonlyArray<SongSummary>
  readonly following: boolean
}) {
  const player = usePlayer()
  const playing = following && player.isPlaying
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        size="lg"
        disabled={!song.audioUrl}
        className="h-11 rounded-full bg-white px-6 text-[#0c1d2e] hover:bg-gold"
        onClick={() => (following ? player.toggle() : player.play(song, queue))}
      >
        {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
        {playing ? "Pause" : following ? "Resume" : "Play featured"}
      </Button>
      {song.hasVideo && (
        <Button
          size="lg"
          variant="outline"
          className="h-11 rounded-full border-white/15 bg-white/[0.04] px-5"
          onClick={() => player.openVideo(following ? undefined : { song })}
        >
          <TvMinimalPlayIcon /> Watch music video
        </Button>
      )}
      {following && <HeroClock />}
    </div>
  )
}

function HeroClock() {
  const { duration } = usePlayer()
  const time = useCurrentTime(2)
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground tabular-nums")}>
      <AudioLinesIcon className="size-4 text-gold" />
      {formatDuration(time)} / {formatDuration(duration || null)}
    </span>
  )
}
