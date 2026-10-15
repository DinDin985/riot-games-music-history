"use client"

import Link from "next/link"
import { AudioLinesIcon, ListPlusIcon, TvMinimalPlayIcon } from "lucide-react"
import type { ArtistRole, SongSummary } from "@workspace/db/domain/types"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatCompactNumber, formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"
import { SongPlayButton } from "@/components/songs/play-button"
import { CategoryBadge, GameBadge } from "@/components/songs/song-badges"
import { ROLE_LABEL } from "../../_components/artist-meta"

const ROLE_STYLE: Readonly<Record<ArtistRole, string>> = {
  primary: "border-white/15 text-foreground/80",
  featured: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  remixer: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  composer: "border-gold/30 bg-gold/10 text-gold",
}

/** Credit-role pill (featured / remixer / composer / artist). */
export function RoleBadge({ role, className }: { readonly role: ArtistRole; readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        ROLE_STYLE[role],
        className,
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

/**
 * Song row on an artist page: number/play, cover, title + credit line, the
 * artist's role on the song, category and game, year, views, MV marker,
 * add-to-queue and length. Highlights the song that is loaded in the player.
 */
export function ArtistSongRow({
  song,
  role,
  queue,
  index,
}: {
  readonly song: SongSummary
  readonly role: ArtistRole
  readonly queue: ReadonlyArray<SongSummary>
  readonly index: number
}) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id
  const playing = isCurrent && player.isPlaying

  return (
    <div
      data-current={isCurrent || undefined}
      className="group/row relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04] data-[current]:bg-white/[0.05]"
    >
      <div className="relative grid w-8 shrink-0 place-items-center text-sm text-muted-foreground tabular-nums">
        <span className={cn("group-focus-within/row:opacity-0 group-hover/row:opacity-0", isCurrent && "opacity-0")}>
          {index}
        </span>
        {playing && (
          <span className="absolute inset-0 grid place-items-center group-hover/row:hidden">
            <AudioLinesIcon className="size-4 animate-pulse text-gold" />
          </span>
        )}
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
      <SongArtwork
        title={song.title}
        coverUrl={song.coverUrl}
        palette={song.palette}
        seed={song.id}
        animatedBackdrop={false}
        className="size-11 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/songs/${song.id}`}
            className={cn(
              "truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60",
              isCurrent && "text-gold",
            )}
          >
            {song.title}
          </Link>
          {role !== "primary" && <RoleBadge role={role} className="sm:hidden" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{song.displayArtist}</p>
      </div>
      <span className="hidden w-24 justify-end sm:flex">{role !== "primary" && <RoleBadge role={role} />}</span>
      <span className="hidden w-40 justify-end gap-1.5 overflow-hidden lg:flex">
        <CategoryBadge categoryId={song.primaryCategoryId} />
      </span>
      <GameBadge gameId={song.gameId} short className="hidden md:inline-flex" />
      <span className="hidden w-10 text-right text-xs text-muted-foreground tabular-nums sm:block">
        {song.year ?? ""}
      </span>
      <span
        className="hidden w-14 text-right text-xs text-muted-foreground tabular-nums xl:block"
        title="YouTube views"
      >
        {song.viewCount !== null ? formatCompactNumber(song.viewCount) : ""}
      </span>
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
      <span className="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatDuration(song.duration)}
      </span>
    </div>
  )
}
