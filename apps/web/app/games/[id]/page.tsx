import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRightIcon, LibraryIcon, MusicIcon } from "lucide-react"
import type { ArtistSummary, SongSort } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { formatCompactNumber, formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { SectionHeader } from "@/components/section-header"
import { SongGrid } from "@/components/songs/song-grid"
import { safeDecode } from "@/lib/server/http"
import { getGames, hasDatabase, listArtists, listSongs } from "@/lib/server/repo"
import { DEFAULT_PAGE_SIZE } from "@/lib/song-filter"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"
import { ArtistAvatar } from "../../artists/_components/artist-avatar"
import { KIND_LABEL, RIOT_IN_HOUSE_ID } from "../../artists/_components/artist-meta"
import { BreakdownChips } from "../../categories/_components/breakdown-chips"
import {
  collectionStats,
  getAllSongs,
  isSlug,
  pageParam,
  searchParam,
  yearSpan,
} from "../../categories/_components/collection-data"
import { CollectionHero, type HeroStat } from "../../categories/_components/collection-hero"
import { PlayCollectionButton } from "../../categories/_components/play-collection-button"
import { SongPagination } from "../../categories/_components/song-pagination"
import { SortControl, type SortOption } from "../../categories/_components/sort-control"
import { YearHistogram } from "../_components/year-histogram"

interface Props {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<Record<string, string | Array<string> | undefined>>
}

const SORTS: ReadonlyArray<SortOption> = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
]
const DEFAULT_SORT = "popular"
const PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * The `n` artists with the most songs *for this game*. `artists` is sorted by
 * overall song count, which bounds the per-game count, so the scan stops as
 * soon as no remaining artist can enter the top `n`.
 */
async function topArtistsForGame(
  artists: ReadonlyArray<ArtistSummary>,
  gameId: string,
  n = 12,
): Promise<Array<{ readonly artist: ArtistSummary; readonly count: number }>> {
  const best: Array<{
    readonly artist: ArtistSummary
    readonly count: number
  }> = []
  const CHUNK = 12
  for (let i = 0; i < artists.length; i += CHUNK) {
    const chunk = artists.slice(i, i + CHUNK)
    if (best.length >= n && chunk[0]!.songCount <= best[n - 1]!.count) break
    const counts = await Promise.all(
      chunk.map((a) => listSongs({ artist: a.id, game: gameId, limit: 1 }).then((p) => p.total)),
    )
    chunk.forEach((artist, j) => best.push({ artist, count: counts[j] ?? 0 }))
    best.sort(
      (x, y) =>
        y.count - x.count || y.artist.songCount - x.artist.songCount || x.artist.name.localeCompare(y.artist.name),
    )
    best.splice(n)
  }
  return best.filter((b) => b.count > 0)
}

async function findGame(rawId: string) {
  const id = safeDecode(rawId).toLowerCase()
  if (!isSlug(id) || !hasDatabase()) return null
  return (await getGames()).find((g) => g.id === id) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const game = await findGame(id)
  if (!game)
    return {
      title: hasDatabase() ? "Game not found" : gameInfo(safeDecode(id)).name,
    }
  return {
    title: `${game.name} music`,
    description: `${pluralize(game.songCount, "song")} from ${game.name}: themes, cinematics, anthems and soundtracks in the Riot Games Music Archive.`,
  }
}

export default async function GamePage({ params, searchParams }: Props) {
  if (!hasDatabase()) return <DatabaseMissing />
  const { id: rawId } = await params
  const game = await findGame(rawId)
  if (!game) notFound()
  const id = game.id

  const [query, all, artists] = await Promise.all([searchParams, getAllSongs(), listArtists()])
  const requested = searchParam(query, "sort")
  const sort = (SORTS.some((o) => o.value === requested) ? requested : DEFAULT_SORT) as SongSort

  const songs = all.filter((s) => s.gameId === id)
  const stats = collectionStats(songs, 4)
  const span = yearSpan(stats.firstYear, stats.lastYear)
  const pageCount = Math.max(1, Math.ceil(stats.songCount / PAGE_SIZE))
  const page = pageParam(query, pageCount)
  const list = await listSongs({
    game: id,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  const gameArtists = artists.filter((a) => a.id !== RIOT_IN_HOUSE_ID && a.gameIds.includes(id))
  const topArtists = await topArtistsForGame(gameArtists, id)

  const heroStats: Array<HeroStat> = [
    {
      label: stats.songCount === 1 ? "song" : "songs",
      value: formatNumber(stats.songCount),
    },
    {
      label: stats.videoCount === 1 ? "music video" : "music videos",
      value: formatNumber(stats.videoCount),
    },
  ]
  if (gameArtists.length > 0)
    heroStats.push({
      label: "collaborators",
      value: formatNumber(gameArtists.length),
    })
  if (span)
    heroStats.push({
      label: stats.firstYear === stats.lastYear ? "year" : "years",
      value: span,
    })
  if (stats.totalViews > 0)
    heroStats.push({
      label: "YouTube views",
      value: formatCompactNumber(stats.totalViews),
    })

  return (
    <div className="flex flex-col" style={{ "--game": game.color } as React.CSSProperties}>
      <CollectionHero
        parent={{ href: "/games", label: "Games" }}
        eyebrow={`Game · ${game.short}`}
        title={game.name}
        description={
          stats.songCount > 0
            ? `${pluralize(stats.songCount, "song")} from ${game.name}${span ? `, ${span}` : ""} — across ${pluralize(stats.byCategory.length, "category", "categories")}.`
            : `No ${game.name} songs are in the archive yet.`
        }
        palette={stats.top[0] ? [game.color, ...stats.top[0].palette] : [game.color, "#0c1d2e", "#173149"]}
        seed={id}
        accent={game.color}
        songs={stats.top}
        stats={heroStats}
        actions={
          stats.songCount > 0 ? (
            <>
              <PlayCollectionButton
                filter={{ game: id, sort }}
                disabled={stats.playableCount === 0}
                className="bg-[var(--game)] text-[#0c1d2e] hover:bg-[color-mix(in_oklab,var(--game)_80%,white)]"
              />
              <PlayCollectionButton filter={{ game: id }} shuffle disabled={stats.playableCount === 0} />
              <Button asChild size="lg" variant="ghost" className="rounded-full px-4 text-white/80 hover:text-white">
                <Link href={`/songs?game=${id}`}>
                  <LibraryIcon /> Open in library
                </Link>
              </Button>
            </>
          ) : null
        }
      >
        <BreakdownChips
          label={`${game.name} songs by category`}
          items={stats.byCategory.map((c) => ({
            id: c.id,
            label: categoryInfo(c.id).name,
            count: c.count,
            color: game.color,
            href: `/songs?game=${id}&category=${c.id}`,
          }))}
        />
      </CollectionHero>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-14 px-4 py-10 pb-16 md:px-6 md:py-12">
        {stats.byYear.length > 1 && (
          <section
            aria-labelledby="years-heading"
            className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-end"
          >
            <div>
              <h2 id="years-heading" className="text-4xl leading-none md:text-5xl">
                Year by year
              </h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                How many {game.name} songs came out each year. Pick a year to open it in the library.
              </p>
            </div>
            <YearHistogram
              data={stats.byYear}
              color={game.color}
              hrefFor={(year) => `/songs?game=${id}&year=${year}`}
            />
          </section>
        )}

        <section id="songs" aria-labelledby="songs-heading" className="scroll-mt-20">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="songs-heading" className="text-4xl leading-none md:text-5xl">
                Songs
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {pageCount > 1
                  ? `${formatNumber((page - 1) * PAGE_SIZE + 1)}–${formatNumber(Math.min(page * PAGE_SIZE, list.total))} of ${pluralize(list.total, "song")}`
                  : pluralize(list.total, "song")}
              </p>
            </div>
            {stats.songCount > 1 && <SortControl options={SORTS} value={sort} defaultValue={DEFAULT_SORT} />}
          </div>
          {list.items.length === 0 ? (
            <Empty className="border border-dashed border-white/10 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MusicIcon />
                </EmptyMedia>
                <EmptyTitle>No songs yet</EmptyTitle>
                <EmptyDescription>{game.name} music will appear here once the archive includes it.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <SongGrid songs={list.items} cardProps={{ showGame: false }} />
              <SongPagination
                pathname={`/games/${id}`}
                page={page}
                pageCount={pageCount}
                params={{ sort: sort === DEFAULT_SORT ? undefined : sort }}
              />
            </>
          )}
        </section>

        {topArtists.length > 0 && (
          <section aria-labelledby="artists-heading">
            <SectionHeader
              id="artists-heading"
              eyebrow={game.name}
              title="Artists"
              description={`${pluralize(gameArtists.length, "collaborator")} worked on ${game.name} music — these are credited on the most songs.`}
              href="/artists"
              linkLabel="All artists"
            />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {topArtists.map(({ artist: a, count }) => (
                <li key={a.id}>
                  <Link
                    href={`/artists/${a.id}`}
                    className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-card/40 p-2.5 pr-3 transition-colors hover:border-white/15 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    <ArtistAvatar
                      name={a.name}
                      coverUrl={a.coverUrl}
                      palette={a.palette}
                      className="size-12 shrink-0 ring-1 ring-white/10"
                      textClassName="text-xl"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold group-hover:text-[var(--game)]">
                        {a.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {KIND_LABEL[a.kind]} · {pluralize(count, `${game.short} song`)}
                      </span>
                    </span>
                    <ArrowRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
