import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { LibraryIcon, MusicIcon } from "lucide-react"
import type { SongSort } from "@workspace/db/domain/types"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Button } from "@workspace/ui/components/button"
import { formatCompactNumber, formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { SongGrid } from "@/components/songs/song-grid"
import { safeDecode } from "@/lib/server/http"
import { getCategories, hasDatabase, listSongs } from "@/lib/server/repo"
import { DEFAULT_PAGE_SIZE } from "@/lib/song-filter"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"
import { AnthemTimeline } from "../_components/anthem-timeline"
import { BreakdownChips } from "../_components/breakdown-chips"
import { collectionStats, getAllSongs, isSlug, pageParam, searchParam, yearSpan } from "../_components/collection-data"
import { CollectionHero, type HeroStat } from "../_components/collection-hero"
import { PlayCollectionButton } from "../_components/play-collection-button"
import { SongPagination } from "../_components/song-pagination"
import { SortControl, type SortOption } from "../_components/sort-control"

interface Props {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<Record<string, string | Array<string> | undefined>>
}

/** Yearly-event categories render as an anthem timeline (caption per year). */
const TIMELINES: ReadonlyMap<string, (year: number | null) => string> = new Map([
  ["worlds", (year: number | null) => (year ? `Worlds ${year} anthem` : "Worlds anthem")],
  ["worlds-theme", (year: number | null) => (year ? `Worlds ${year} theme` : "Worlds theme")],
  ["msi", (year: number | null) => (year ? `MSI ${year} anthem` : "MSI anthem")],
  ["valorant-champions", (year: number | null) => (year ? `VCT ${year} anthem` : "VCT anthem")],
])

const TIMELINE_SORTS: ReadonlyArray<SortOption> = [
  { value: "oldest", label: "Timeline" },
  { value: "newest", label: "Newest first" },
  { value: "popular", label: "Most popular" },
]
const DEFAULT_SORTS: ReadonlyArray<SortOption> = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
]

const PAGE_SIZE = DEFAULT_PAGE_SIZE

async function findCategory(rawId: string) {
  const id = safeDecode(rawId).toLowerCase()
  if (!isSlug(id) || !hasDatabase()) return null
  return (await getCategories()).find((c) => c.id === id) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const category = await findCategory(id)
  if (!category)
    return {
      title: hasDatabase() ? "Category not found" : categoryInfo(safeDecode(id)).name,
    }
  return {
    title: category.name,
    description: `${category.description} ${pluralize(category.songCount, "song")} in the Riot Games Music Archive.`,
  }
}

export default async function CategoryPage({ params, searchParams }: Props) {
  if (!hasDatabase()) return <DatabaseMissing />
  const { id: rawId } = await params
  const category = await findCategory(rawId)
  if (!category) notFound()
  const id = category.id

  const [query, categories, all] = await Promise.all([searchParams, getCategories(), getAllSongs()])
  const timeline = TIMELINES.get(id)
  const sortOptions = timeline ? TIMELINE_SORTS : DEFAULT_SORTS
  const defaultSort = sortOptions[0]!.value
  const requested = searchParam(query, "sort")
  const sort = (sortOptions.some((o) => o.value === requested) ? requested : defaultSort) as SongSort
  const showTimeline = timeline !== undefined && sort !== "popular"

  const songs = all.filter((s) => s.categoryIds.includes(id) || s.primaryCategoryId === id)
  const stats = collectionStats(songs, 4)
  const span = yearSpan(stats.firstYear, stats.lastYear)
  const pageCount = Math.max(1, Math.ceil(stats.songCount / PAGE_SIZE))
  const page = showTimeline ? 1 : pageParam(query, pageCount)
  const list = await listSongs(
    showTimeline
      ? { category: id, sort, limit: 1000 }
      : { category: id, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
  )

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

  // Other categories these songs are also filed under.
  const related = stats.byCategory
    .filter((c) => c.id !== id)
    .slice(0, 6)
    .map((c) => ({
      ...c,
      category: categories.find((x) => x.id === c.id) ?? null,
    }))
    .filter((c) => c.category !== null)
  const others = categories.filter((c) => c.id !== id && c.songCount > 0 && !related.some((r) => r.id === c.id))

  return (
    <div className="flex flex-col">
      <CollectionHero
        parent={{ href: "/categories", label: "Categories" }}
        eyebrow={timeline ? "Category · anthem timeline" : "Category"}
        title={category.name}
        description={category.description}
        palette={stats.top[0]?.palette ?? []}
        seed={id}
        songs={stats.top}
        stats={heroStats}
        actions={
          <>
            <PlayCollectionButton filter={{ category: id, sort }} disabled={stats.playableCount === 0} />
            <PlayCollectionButton filter={{ category: id }} shuffle disabled={stats.playableCount === 0} />
            <Button asChild size="lg" variant="ghost" className="rounded-full px-4 text-white/80 hover:text-white">
              <Link href={`/songs?category=${id}`}>
                <LibraryIcon /> Open in library
              </Link>
            </Button>
          </>
        }
      >
        <BreakdownChips
          label={`${category.name} by game`}
          items={stats.byGame.map((g) => {
            const game = gameInfo(g.id)
            return {
              id: g.id,
              label: game.name,
              count: g.count,
              color: game.color,
              href: `/songs?game=${g.id}&category=${id}`,
            }
          })}
        />
      </CollectionHero>

      <section
        id="songs"
        aria-labelledby="songs-heading"
        className="mx-auto w-full max-w-[1600px] scroll-mt-20 px-4 py-10 md:px-6 md:py-12"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="songs-heading" className="text-4xl leading-none md:text-5xl">
              {showTimeline ? "Anthem timeline" : "Songs"}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {showTimeline
                ? `${pluralize(stats.songCount, "song")} year by year${span ? `, ${span}` : ""}. Each year's headline anthem comes first.`
                : pageCount > 1
                  ? `${formatNumber((page - 1) * PAGE_SIZE + 1)}–${formatNumber(Math.min(page * PAGE_SIZE, list.total))} of ${pluralize(list.total, "song")}`
                  : pluralize(list.total, "song")}
            </p>
          </div>
          {stats.songCount > 1 && <SortControl options={sortOptions} value={sort} defaultValue={defaultSort} />}
        </div>

        {list.items.length === 0 ? (
          <Empty className="border border-dashed border-white/10 py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MusicIcon />
              </EmptyMedia>
              <EmptyTitle>No songs here yet</EmptyTitle>
              <EmptyDescription>
                Songs filed under {category.name} will appear here once the archive includes them.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : showTimeline && timeline ? (
          <AnthemTimeline songs={list.items} anthemLabel={timeline} />
        ) : (
          <>
            <SongGrid songs={list.items} cardProps={{ showCategory: false }} />
            <SongPagination
              pathname={`/categories/${id}`}
              page={page}
              pageCount={pageCount}
              params={{ sort: sort === defaultSort ? undefined : sort }}
            />
          </>
        )}
      </section>

      {(related.length > 0 || others.length > 0) && (
        <section aria-labelledby="related-heading" className="mx-auto w-full max-w-[1600px] px-4 pb-16 md:px-6">
          <h2 id="related-heading" className="mb-4 text-3xl leading-none md:text-4xl">
            Keep exploring
          </h2>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/categories/${r.id}`}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.06] px-4 text-sm transition-colors hover:border-gold/60 hover:text-gold"
                title={`${pluralize(r.count, "song")} here are also ${r.category!.name}`}
              >
                {r.category!.name}
                <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(r.count)} shared</span>
              </Link>
            ))}
            {others.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.id}`}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-4 text-sm text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground"
              >
                {c.name}
                <span className="text-xs tabular-nums">{formatNumber(c.songCount)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
