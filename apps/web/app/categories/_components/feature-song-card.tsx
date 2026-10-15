"use client"

import Link from "next/link"
import { EyeIcon, TvMinimalPlayIcon } from "lucide-react"
import type { SongSummary } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { formatCompactNumber, formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"
import { SongPlayButton } from "@/components/songs/play-button"
import { CategoryBadge, GameBadge } from "@/components/songs/song-badges"

/**
 * Wide card for a headline song (a year's Worlds anthem): album-cover artwork
 * with a play button, big title, credits, views and length, a "Watch music
 * video" button (synced popup) and a waveform that follows the player while
 * this song is loaded.
 */
export function FeatureSongCard({
  song,
  queue,
  label,
  showCategory = false,
  className,
}: {
  readonly song: SongSummary
  readonly queue?: ReadonlyArray<SongSummary>
  /** Small caption above the title, e.g. "Anthem". */
  readonly label?: string
  readonly showCategory?: boolean
  readonly className?: string
}) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id

  return (
    <article
      data-current={isCurrent || undefined}
      className={cn(
        "group/feature relative flex items-center gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-card/50 p-3 transition-colors hover:border-white/15 hover:bg-card/80 data-[current]:border-gold/40 md:gap-6 md:p-4",
        className,
      )}
    >
      <SongArtwork
        title={song.title}
        coverUrl={song.coverUrl}
        palette={song.palette}
        seed={song.id}
        coverFit={song.hasVideo ? "fill" : "inset"}
        className="aspect-square w-28 shrink-0 rounded-xl sm:w-36 md:w-44"
      >
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <SongPlayButton song={song} queue={queue} className="absolute right-2 bottom-2" />
      </SongArtwork>

      <div className="flex min-w-0 flex-1 flex-col">
        {label && <p className="text-[11px] font-semibold tracking-[0.25em] text-gold uppercase">{label}</p>}
        <Link
          href={`/songs/${song.id}`}
          className={cn(
            "mt-0.5 truncate font-display text-3xl leading-none tracking-wide outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60 md:text-5xl",
            isCurrent && "text-gold",
          )}
        >
          {song.title}
        </Link>
        <p className="mt-1 truncate text-sm text-muted-foreground md:text-base">{song.displayArtist}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          {song.viewCount !== null && (
            <span className="inline-flex items-center gap-1" title="YouTube views">
              <EyeIcon className="size-3.5" /> {formatCompactNumber(song.viewCount)}
            </span>
          )}
          <span>{formatDuration(song.duration)}</span>
          <GameBadge gameId={song.gameId} short />
          {showCategory && <CategoryBadge categoryId={song.primaryCategoryId} />}
        </div>
        {song.hasVideo && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              className="relative z-10 rounded-full"
              onClick={() => (isCurrent ? player.openVideo() : player.openVideo({ song }))}
            >
              <TvMinimalPlayIcon /> Watch music video
            </Button>
          </div>
        )}
      </div>

      <div aria-hidden className="hidden h-20 w-56 shrink-0 opacity-80 lg:block xl:w-72">
        {isCurrent ? (
          <PlayerWaveform variant="card" seekable={false} className="size-full" />
        ) : (
          <Waveform
            variant="card"
            seed={song.id}
            className="size-full opacity-40 transition-opacity group-hover/feature:opacity-80"
          />
        )}
      </div>
    </article>
  )
}
