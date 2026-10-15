import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { LibraryIcon } from "lucide-react"
import type { ArtistDetail, ArtistRole } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { formatCompactNumber, formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { SectionHeader } from "@/components/section-header"
import { PlayAllButton } from "@/components/songs/play-button"
import { GameBadge } from "@/components/songs/song-badges"
import { SongGrid } from "@/components/songs/song-grid"
import { safeDecode } from "@/lib/server/http"
import { getArtist, hasDatabase } from "@/lib/server/repo"
import { GAMES, gameInfo } from "@/lib/taxonomy"
import { isSlug, yearSpan } from "../../categories/_components/collection-data"
import { CollectionHero, type HeroStat } from "../../categories/_components/collection-hero"
import { ArtistAvatar } from "../_components/artist-avatar"
import { KIND_LABEL, RIOT_IN_HOUSE_ID, ROLE_ORDER } from "../_components/artist-meta"
import { RoleBadge } from "./_components/artist-song-row"
import { ArtistSongs } from "./_components/artist-songs"

interface Props {
  readonly params: Promise<{ id: string }>
}

async function findArtist(rawId: string): Promise<ArtistDetail | null> {
  const id = safeDecode(rawId).toLowerCase()
  if (!isSlug(id) || !hasDatabase()) return null
  return getArtist(id)
}

const gameOrder = new Map(GAMES.map((g, i) => [g.id, i]))

const ROLE_PHRASE: Readonly<Record<ArtistRole, (n: number) => string>> = {
  primary: (n) => `artist on ${pluralize(n, "song")}`,
  featured: (n) => `featured on ${pluralize(n, "song")}`,
  remixer: (n) => `${pluralize(n, "remix", "remixes")}`,
  composer: (n) => `composer on ${pluralize(n, "song")}`,
}

function listJoin(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const artist = await findArtist(id)
  if (!artist) return { title: "Artist not found" }
  return {
    title: artist.name,
    description: `${artist.name} — ${KIND_LABEL[artist.kind].toLowerCase()} credited on ${pluralize(artist.songs.length, "Riot Games song")}.`,
  }
}

export default async function ArtistPage({ params }: Props) {
  if (!hasDatabase()) return <DatabaseMissing />
  const { id } = await params
  const artist = await findArtist(id)
  if (!artist) notFound()

  const songs = artist.songs
  const unique = songs.filter((s, i) => songs.findIndex((x) => x.id === s.id) === i)
  const popular = [...unique].sort(
    (a, b) => Number(b.isImpact) - Number(a.isImpact) || (b.viewCount ?? 0) - (a.viewCount ?? 0),
  )
  const years = unique.flatMap((s) => (s.year === null ? [] : [s.year]))
  const span = years.length > 0 ? yearSpan(Math.min(...years), Math.max(...years)) : null
  const totalViews = unique.reduce((n, s) => n + (s.viewCount ?? 0), 0)
  const videoCount = unique.filter((s) => s.hasVideo).length
  const games = [...artist.gameIds].sort((a, b) => (gameOrder.get(a) ?? 99) - (gameOrder.get(b) ?? 99))
  const roles = ROLE_ORDER.map((role) => ({
    role,
    count: songs.filter((s) => s.role === role).length,
  })).filter((r) => r.count > 0)
  const inHouse = artist.id === RIOT_IN_HOUSE_ID

  const description =
    artist.bio ??
    (inHouse
      ? `Riot's in-house music team — songs credited to the studio as a whole${span ? `, ${span}` : ""}.`
      : `${KIND_LABEL[artist.kind]}: ${listJoin(roles.map((r) => ROLE_PHRASE[r.role](r.count)))}${
          games.length > 0 ? ` for ${listJoin(games.map((g) => gameInfo(g).name))}` : ""
        }${span ? `, ${span}` : ""}.`)

  const stats: Array<HeroStat> = [
    {
      label: unique.length === 1 ? "song" : "songs",
      value: formatNumber(unique.length),
    },
  ]
  if (videoCount > 0)
    stats.push({
      label: videoCount === 1 ? "music video" : "music videos",
      value: formatNumber(videoCount),
    })
  if (span)
    stats.push({
      label: years.length > 0 && Math.min(...years) === Math.max(...years) ? "year" : "years active",
      value: span,
    })
  if (totalViews > 0)
    stats.push({
      label: "YouTube views",
      value: formatCompactNumber(totalViews),
    })

  return (
    <div className="flex flex-col">
      <CollectionHero
        parent={{ href: "/artists", label: "Artists" }}
        eyebrow={inHouse ? "In-house credit" : KIND_LABEL[artist.kind]}
        title={artist.name}
        description={description}
        palette={artist.palette}
        seed={artist.id}
        stats={stats}
        media={
          <ArtistAvatar
            name={artist.name}
            coverUrl={artist.imageUrl ?? artist.coverUrl}
            palette={artist.palette}
            className="size-36 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)] ring-4 ring-white/10 sm:size-44 lg:mr-8 lg:size-56"
            textClassName="text-6xl lg:text-7xl"
          />
        }
        actions={
          <>
            <PlayAllButton songs={popular} />
            {popular.length > 1 && <PlayAllButton songs={popular} shuffle />}
            <Button asChild size="lg" variant="ghost" className="rounded-full px-4 text-white/80 hover:text-white">
              <Link href={`/songs?artist=${artist.id}`}>
                <LibraryIcon /> Open in library
              </Link>
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {games.map((g) => (
            <GameBadge key={g} gameId={g} className="h-6 px-2.5 text-xs" />
          ))}
          {roles.length > 0 && games.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />}
          {roles.map((r) => (
            <span key={r.role} className="inline-flex items-center gap-1.5 text-xs text-white/70">
              <RoleBadge role={r.role} /> {formatNumber(r.count)}
            </span>
          ))}
        </div>
      </CollectionHero>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-14 px-4 py-10 pb-16 md:px-6 md:py-12">
        {unique.length > 6 && (
          <section aria-labelledby="popular-heading">
            <SectionHeader id="popular-heading" eyebrow={artist.name} title="Most popular" />
            <SongGrid songs={popular.slice(0, 6)} queue={popular} />
          </section>
        )}
        <section aria-labelledby="songs-heading">
          <SectionHeader
            id="songs-heading"
            title={unique.length > 6 ? "All songs" : "Songs"}
            description={`Every song ${artist.name} is credited on, with the role they played.`}
          />
          <ArtistSongs songs={songs} />
        </section>
      </div>
    </div>
  )
}
