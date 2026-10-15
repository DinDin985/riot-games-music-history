"use client"

import * as React from "react"
import Link from "next/link"
import { TvMinimalPlayIcon } from "lucide-react"
import type { SongSummary } from "@workspace/db/domain/types"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { formatViews } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"
import { PlayerWaveform } from "@/components/player/player-waveform"
import { SongPlayButton } from "@/components/songs/play-button"
import { CategoryBadge, GameBadge } from "@/components/songs/song-badges"

/**
 * Song tile for grids and strips.
 *
 * Artwork: the still album cover — edge to edge when the song has a music
 * video, otherwise as a sleeve on an animated gradient in the cover's
 * colours. Hovering (or playing) shows the waveform
 * across the bottom of the artwork; the play button plays the song with
 * `queue` as the queue. The whole card links to /songs/<id>.
 *
 * Props:
 * - `song` — the SongSummary to show (required).
 * - `queue` — songs to queue when played from this card (e.g. the whole grid).
 * - `rank` — optional big "#n" overlay (impact / charts).
 * - `showGame` / `showCategory` — badges under the title (default true).
 * - `showViews` — view count in the meta line (default true).
 * - `priority` — eager-load the cover (first row above the fold).
 * - `className` — extra classes on the outer <article>.
 */
export interface SongCardProps {
  readonly song: SongSummary
  readonly queue?: ReadonlyArray<SongSummary>
  readonly rank?: number
  readonly showGame?: boolean
  readonly showCategory?: boolean
  readonly showViews?: boolean
  readonly priority?: boolean
  readonly className?: string
}

export function SongCard({
  song,
  queue,
  rank,
  showGame = true,
  showCategory = true,
  showViews = true,
  priority = false,
  className,
}: SongCardProps) {
  const player = usePlayer()
  const [hovered, setHovered] = React.useState(false)
  const isCurrent = player.song?.id === song.id
  const showWave = hovered || isCurrent
  const views = showViews ? formatViews(song.viewCount) : null

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      data-current={isCurrent || undefined}
      className={cn(
        "group/card relative flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-card/40 p-2.5 transition-[transform,background-color,border-color,box-shadow] duration-300",
        "hover:-translate-y-0.5 hover:border-white/15 hover:bg-card/80 hover:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)]",
        "data-[current]:border-gold/40",
        className,
      )}
    >
      <SongArtwork
        title={song.title}
        coverUrl={song.coverUrl}
        palette={song.palette}
        seed={song.id}
        coverFit={song.hasVideo ? "fill" : "inset"}
        priority={priority}
        className="aspect-square w-full rounded-xl"
      >
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#0c1d2e]/85 via-[#0c1d2e]/10 to-transparent" />
        {rank !== undefined && (
          <span className="absolute top-1.5 left-3 font-display text-5xl leading-none text-white drop-shadow-[0_4px_12px_rgb(0_0_0/0.7)]">
            {rank}
          </span>
        )}
        {song.hasVideo && (
          <span
            title="Has a music video"
            className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase backdrop-blur"
          >
            <TvMinimalPlayIcon className="size-3" /> MV
          </span>
        )}
        <div
          className={cn(
            "absolute inset-x-3 bottom-3 h-9 transition-opacity duration-300",
            showWave ? "opacity-100" : "opacity-0",
            "mr-14",
          )}
        >
          {showWave &&
            (isCurrent ? (
              <PlayerWaveform variant="card" seekable={false} className="size-full" aria-label={`${song.title} waveform`} />
            ) : (
              <Waveform variant="card" seed={song.id} className="size-full" aria-label={`${song.title} waveform`} />
            ))}
        </div>
        <SongPlayButton
          song={song}
          queue={queue}
          className={cn(
            "absolute right-2.5 bottom-2.5 transition-[opacity,transform] duration-200",
            isCurrent
              ? "opacity-100"
              : "translate-y-1 opacity-0 group-hover/card:translate-y-0 group-hover/card:opacity-100 group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 disabled:opacity-0 group-hover/card:disabled:opacity-40",
          )}
        />
      </SongArtwork>

      <div className="flex min-w-0 flex-col gap-1 px-1 pb-1">
        <Link
          href={`/songs/${song.id}`}
          className={cn(
            "truncate font-semibold leading-tight outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60",
            isCurrent && "text-gold",
          )}
        >
          {song.title}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {song.displayArtist}
          {song.year ? <span className="text-muted-foreground/70"> · {song.year}</span> : null}
          {views ? <span className="text-muted-foreground/70"> · {views}</span> : null}
        </p>
        {(showGame || showCategory) && (
          <div className="mt-1 flex min-w-0 gap-1.5 overflow-hidden">
            {showCategory && <CategoryBadge categoryId={song.primaryCategoryId} />}
            {showGame && <GameBadge gameId={song.gameId} short />}
          </div>
        )}
      </div>
    </article>
  )
}
