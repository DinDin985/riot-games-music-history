import Link from "next/link"
import type { ArtistKind } from "@workspace/db/domain/types"
import { pluralize } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { GameBadge } from "@/components/songs/song-badges"
import { ArtistAvatar } from "./artist-avatar"
import { KIND_LABEL } from "./artist-meta"

/** The fields an artist card needs (a slimmed `ArtistSummary`). */
export interface ArtistCardData {
  readonly id: string
  readonly name: string
  readonly kind: ArtistKind
  readonly songCount: number
  readonly gameIds: ReadonlyArray<string>
  readonly coverUrl: string | null
  readonly palette: ReadonlyArray<string>
}

/**
 * Artist tile: avatar (top song cover, or palette + initials), name, kind,
 * song count and the games they worked on. The whole card links to
 * /artists/<id>. Hook-free, so it renders in Server and Client Components.
 */
export function ArtistCard({ artist, className }: { readonly artist: ArtistCardData; readonly className?: string }) {
  const glow = artist.palette[0] ?? "#c89b3c"
  return (
    <article
      className={cn(
        "group/artist relative flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-card/40 px-3 pt-5 pb-4 text-center transition-[transform,background-color,border-color,box-shadow] duration-300",
        "focus-within:border-white/20 hover:-translate-y-0.5 hover:border-white/15 hover:bg-card/80 hover:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)]",
        className,
      )}
    >
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-[-12%] rounded-full opacity-0 blur-xl transition-opacity duration-500 group-hover/artist:opacity-70"
          style={{ backgroundColor: glow }}
        />
        <ArtistAvatar
          name={artist.name}
          coverUrl={artist.coverUrl}
          palette={artist.palette}
          className="size-24 shadow-[0_12px_30px_-12px_rgb(0_0_0/0.8)] ring-2 ring-white/10 transition-[box-shadow] group-hover/artist:ring-white/30 sm:size-28"
          textClassName="text-4xl"
        />
      </div>
      <div className="w-full min-w-0">
        <Link
          href={`/artists/${artist.id}`}
          className="block truncate leading-tight font-semibold outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
        >
          {artist.name}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {KIND_LABEL[artist.kind]} · {pluralize(artist.songCount, "song")}
        </p>
      </div>
      {artist.gameIds.length > 0 && (
        <div className="pointer-events-none flex max-w-full flex-wrap justify-center gap-1">
          {artist.gameIds.slice(0, 3).map((g) => (
            <GameBadge key={g} gameId={g} short link={false} />
          ))}
          {artist.gameIds.length > 3 && (
            <span className="inline-flex h-5 items-center rounded-full bg-white/[0.06] px-1.5 text-[11px] text-muted-foreground">
              +{artist.gameIds.length - 3}
            </span>
          )}
        </div>
      )}
    </article>
  )
}
