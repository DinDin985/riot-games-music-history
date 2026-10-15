"use client"

import * as React from "react"
import Link from "next/link"
import { AudioLinesIcon, ListPlusIcon, TvMinimalPlayIcon } from "lucide-react"
import type { SongSummary } from "@workspace/db/domain/types"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatCompactNumber, formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"
import { SongPlayButton } from "@/components/songs/play-button"
import { GameBadge } from "@/components/songs/song-badges"

/**
 * Compact list row: index/play, cover, title + artist, game, year, views,
 * duration, MV marker and "add to queue". The current song is highlighted.
 *
 * Props:
 * - `song` (required), `queue` — list to play through (usually the whole list).
 * - `index` — 1-based number shown in the first column (hidden when omitted).
 * - `showCover` (default true), `showGame` (default true), `showViews` (default true), `showYear` (default true).
 * - `className`.
 */
export interface SongRowProps {
  readonly song: SongSummary
  readonly queue?: ReadonlyArray<SongSummary>
  readonly index?: number
  readonly showCover?: boolean
  readonly showGame?: boolean
  readonly showViews?: boolean
  readonly showYear?: boolean
  readonly className?: string
}

export function SongRow({
  song,
  queue,
  index,
  showCover = true,
  showGame = true,
  showViews = true,
  showYear = true,
  className,
}: SongRowProps) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id
  const playing = isCurrent && player.isPlaying

  return (
    <div
      data-current={isCurrent || undefined}
      className={cn(
        "group/row relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04] data-[current]:bg-white/[0.05]",
        className,
      )}
    >
      {index !== undefined && (
        <div className="relative grid w-8 shrink-0 place-items-center text-sm text-muted-foreground tabular-nums">
          <span className={cn("group-hover/row:opacity-0 group-focus-within/row:opacity-0", isCurrent && "opacity-0")}>{index}</span>
          <span className="absolute inset-0 grid place-items-center">
            {isCurrent && !playing ? null : isCurrent ? (
              <AudioLinesIcon className="size-4 animate-pulse text-gold group-hover/row:hidden" />
            ) : null}
          </span>
          <SongPlayButton
            song={song}
            queue={queue}
            size="sm"
            variant="ghost"
            className={cn(
              "absolute inset-0 m-auto opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 disabled:opacity-0 group-hover/row:disabled:opacity-40",
              isCurrent && !playing && "opacity-100",
            )}
          />
        </div>
      )}
      {showCover && (
        <SongArtwork
          title={song.title}
          coverUrl={song.coverUrl}
          palette={song.palette}
          seed={song.id}
          animatedBackdrop={false}
          className="size-11 shrink-0 rounded-md"
        >
          {index === undefined && (
            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
              <SongPlayButton song={song} queue={queue} size="sm" variant="ghost" />
            </span>
          )}
        </SongArtwork>
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/songs/${song.id}`}
          className={cn(
            "block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60",
            isCurrent && "text-gold",
          )}
        >
          {song.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{song.displayArtist}</p>
      </div>
      {showGame && <GameBadge gameId={song.gameId} short className="hidden md:inline-flex" />}
      {showYear && <span className="hidden w-10 text-right text-xs text-muted-foreground tabular-nums sm:block">{song.year ?? ""}</span>}
      {showViews && (
        <span className="hidden w-14 text-right text-xs text-muted-foreground tabular-nums lg:block" title="YouTube views">
          {song.viewCount !== null ? formatCompactNumber(song.viewCount) : ""}
        </span>
      )}
      <span className="w-5 shrink-0" title={song.hasVideo ? "Has a music video" : undefined}>
        {song.hasVideo && <TvMinimalPlayIcon className="size-4 text-gold/80" aria-label="Has a music video" />}
      </span>
      <button
        type="button"
        onClick={() => player.enqueue(song)}
        disabled={!song.audioUrl}
        aria-label={`Add ${song.title} to the queue`}
        className="relative z-10 hidden size-7 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 disabled:hidden sm:grid"
      >
        <ListPlusIcon className="size-4" />
      </button>
      <span className="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{formatDuration(song.duration)}</span>
    </div>
  )
}

/** Vertical list of SongRows that share one queue. */
export function SongList({
  songs,
  numbered = true,
  startIndex = 1,
  className,
  rowProps,
}: {
  readonly songs: ReadonlyArray<SongSummary>
  readonly numbered?: boolean
  readonly startIndex?: number
  readonly className?: string
  readonly rowProps?: Omit<SongRowProps, "song" | "queue" | "index">
}) {
  return (
    <div role="list" className={cn("flex flex-col", className)}>
      {songs.map((song, i) => (
        <div role="listitem" key={song.id}>
          <SongRow song={song} queue={songs} index={numbered ? startIndex + i : undefined} {...rowProps} />
        </div>
      ))}
    </div>
  )
}
