import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import type { ArtistDetail } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { pluralize } from "@workspace/ui/components/riot/format"
import { PlayAllButton } from "@/components/songs/play-button"
import { GameBadge } from "@/components/songs/song-badges"
import { CoverStack } from "../../categories/_components/cover-mosaic"
import { ArtistAvatar } from "./artist-avatar"

/**
 * Highlighted card for the in-house "Riot Games Music" credit, kept apart
 * from the collaborator grid: songs the studio credits to its music team as a
 * whole rather than to a named artist.
 */
export function InHouseCard({ artist }: { readonly artist: ArtistDetail }) {
  const byViews = [...artist.songs].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
  const years = artist.songs.flatMap((s) => (s.year === null ? [] : [s.year]))
  const span = years.length > 0 ? `${Math.min(...years)}–${Math.max(...years)}` : null
  return (
    <section
      aria-labelledby="in-house-heading"
      className="relative isolate overflow-hidden rounded-3xl border border-gold/30 shadow-[0_30px_80px_-40px_color-mix(in_oklab,var(--gold)_45%,transparent)]"
    >
      <PaletteBackdrop
        palette={["#c89b3c", "#d13639", ...artist.palette]}
        seed={artist.id}
        className="absolute inset-0 -z-10 opacity-50"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0c1d2e] via-[#0c1d2e]/85 to-[#0c1d2e]/40"
      />
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center md:p-8">
        <ArtistAvatar
          name={artist.name}
          coverUrl={artist.coverUrl}
          palette={artist.palette}
          className="size-24 shrink-0 ring-2 ring-gold/60 ring-offset-4 ring-offset-[#0c1d2e] md:size-32"
          textClassName="text-5xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">In-house credit</p>
          <h2 id="in-house-heading" className="mt-1 text-5xl leading-none md:text-6xl">
            {artist.name}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-pretty text-white/75 md:text-base">
            Riot&apos;s own music team. Tracks the studio credits to the team as a whole rather than to a named composer
            — {pluralize(artist.songs.length, "song")}
            {span ? ` from ${span}` : ""}. Not counted among the collaborators below.
          </p>
          {artist.gameIds.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {artist.gameIds.map((g) => (
                <GameBadge key={g} gameId={g} />
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <PlayAllButton songs={byViews} />
            <Button asChild size="lg" variant="outline" className="rounded-full px-5">
              <Link href={`/artists/${artist.id}`}>
                View all songs <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </div>
        <CoverStack songs={byViews} className="mr-12 hidden size-44 lg:block xl:size-48" />
      </div>
    </section>
  )
}
