import type { Metadata } from "next"
import Link from "next/link"
import { TvMinimalPlayIcon } from "lucide-react"
import type { Category, SongSummary } from "@workspace/db/domain/types"
import { formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { distinctCovers } from "@/lib/artwork"
import { getCategories, hasDatabase } from "@/lib/server/repo"
import { gameInfo } from "@/lib/taxonomy"
import { collectionStats, getAllSongs, yearSpan, type CollectionStats } from "./_components/collection-data"
import { CoverMosaic } from "./_components/cover-mosaic"
import { PageIntro } from "./_components/page-intro"

export const metadata: Metadata = {
  title: "Categories",
  description:
    "Every kind of Riot Games music: Worlds anthems, champion themes, cinematics, Arcane, virtual groups, login screens, skin lines, soundtracks and remixes.",
}

export default async function CategoriesPage() {
  if (!hasDatabase()) return <DatabaseMissing />

  const [categories, songs] = await Promise.all([getCategories(), getAllSongs()])
  const cards = categories.map((category) => {
    const inCategory = songs.filter((s) => s.categoryIds.includes(category.id) || s.primaryCategoryId === category.id)
    return { category, songs: inCategory, stats: collectionStats(inCategory, 3) }
  })
  // Songs sit in several categories, so each mosaic gets covers no other card shows (grid of up to 3 columns).
  const covers = distinctCovers(cards.map((c) => c.songs), 3, 3)
  const tagged = cards.reduce((n, c) => n + c.category.songCount, 0)

  return (
    <div className="flex flex-col">
      <PageIntro
        eyebrow="Browse by"
        title="Categories"
        seed="categories"
        description="From the yearly Worlds anthem to login-screen themes and in-universe pop groups — every song in the archive is filed under one or more of these categories."
        stats={[
          { label: "categories", value: formatNumber(categories.length) },
          { label: "songs", value: formatNumber(songs.length) },
          { label: "tags", value: formatNumber(tagged) },
        ]}
      />
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-4 px-4 pb-16 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
        {cards.map(({ category, stats }, i) => (
          <CategoryCard key={category.id} category={category} stats={stats} covers={covers[i] ?? []} />
        ))}
      </div>
    </div>
  )
}

function CategoryCard({
  category,
  stats,
  covers,
}: {
  readonly category: Category
  readonly stats: CollectionStats
  readonly covers: ReadonlyArray<SongSummary>
}) {
  const span = yearSpan(stats.firstYear, stats.lastYear)
  const empty = category.songCount === 0
  return (
    <Link
      href={`/categories/${category.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-card/40 transition-[transform,background-color,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-card/75 hover:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
    >
      <CoverMosaic songs={covers} seed={category.id} className="aspect-[16/9]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0c1d2e]/70 via-transparent to-transparent"
        />
        <span className="absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-white uppercase backdrop-blur">
          {empty ? "Coming soon" : pluralize(category.songCount, "song")}
        </span>
      </CoverMosaic>
      <div className="flex flex-1 flex-col gap-2 p-4 md:p-5">
        <h2 className="text-3xl leading-none transition-colors group-hover:text-gold md:text-4xl">{category.name}</h2>
        <p className="line-clamp-2 text-sm text-muted-foreground">{category.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2 text-xs text-muted-foreground">
          {span && <span className="tabular-nums">{span}</span>}
          {stats.videoCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <TvMinimalPlayIcon className="size-3.5 text-gold/80" /> {pluralize(stats.videoCount, "music video")}
            </span>
          )}
          {stats.byGame.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5" aria-label="Games">
              {stats.byGame.slice(0, 4).map((g) => {
                const game = gameInfo(g.id)
                return (
                  <span
                    key={g.id}
                    title={`${game.name}: ${pluralize(g.count, "song")}`}
                    className="inline-flex items-center gap-1"
                  >
                    <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: game.color }} />
                    {game.short}
                  </span>
                )
              })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
