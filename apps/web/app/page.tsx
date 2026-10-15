import Link from "next/link"
import { ArrowRightIcon, LibraryIcon, TrophyIcon } from "lucide-react"
import type { ArchiveStats, Award, Category, Game, SongSummary } from "@workspace/db/domain/types"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { DatabaseMissing } from "@/components/database-missing"
import { HeroWaveform } from "@/components/home/hero-player"
import { SectionHeader } from "@/components/section-header"
import { SearchTrigger } from "@/components/site/search-command"
import { SongGrid } from "@/components/songs/song-grid"
import { distinctCovers } from "@/lib/artwork"
import {
  getAnalysis,
  getAwards,
  getCategories,
  getGames,
  getImpactStories,
  getSongsByIds,
  getStats,
  hasDatabase,
  listSongs,
} from "@/lib/server/repo"

/** Songs fetched per category for the home tiles, so a tile can pass over covers another tile already shows. */
const CATEGORY_COVER_CANDIDATES = 24

export default async function HomePage() {
  if (!hasDatabase()) return <HomeWithoutDatabase />

  const [stats, categories, games, latest, popular, stories, awards] = await Promise.all([
    getStats(),
    getCategories(),
    getGames(),
    listSongs({ sort: "newest", limit: 12 }),
    listSongs({ sort: "popular", limit: 24 }),
    getImpactStories(),
    getAwards(),
  ])

  // "Most impactful": curated impact stories in rank order, topped up with
  // songs flagged isImpact, then with the most popular songs.
  const storyIds = stories.flatMap((s) => (s.songId ? [s.songId] : []))
  const fromStories = storyIds.length > 0 ? await getSongsByIds(storyIds) : []
  const impact = dedupe([...fromStories, ...popular.items.filter((s) => s.isImpact)]).slice(0, 12)
  const impactStrip = impact.length >= 4 ? impact : dedupe([...impact, ...popular.items]).slice(0, 12)

  const featured =
    impactStrip.find((s) => s.audioUrl && s.hasVideo) ?? impactStrip.find((s) => s.audioUrl) ?? popular.items[0] ?? null
  const [featuredAnalysis, categorySongs] = await Promise.all([
    featured ? getAnalysis(featured.id) : Promise.resolve(null),
    Promise.all(categories.map((c) => listSongs({ category: c.id, limit: CATEGORY_COVER_CANDIDATES }).then((p) => p.items))),
  ])

  return (
    <div className="flex flex-col">
      <Hero stats={stats} featured={featured} featuredAnalysis={featuredAnalysis} queue={impactStrip} />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-16 px-4 md:px-6">
        {impactStrip.length > 0 && (
          <section aria-labelledby="impact-heading">
            <SectionHeader
              id="impact-heading"
              eyebrow="Community favourites"
              title="Most impactful"
              description="The anthems that defined Worlds, launched virtual bands and broke out of the game."
              href="/impact"
              linkLabel="Read the stories"
              astro
            />
            <SongGrid songs={impactStrip} columns="strip" ranked={impact.length >= 4} cardProps={{ showCategory: false }} />
          </section>
        )}

        <CategoriesSection categories={categories} songs={categorySongs} />

        <GamesSection games={games} />

        {latest.items.length > 0 && (
          <section aria-labelledby="latest-heading">
            <SectionHeader
              id="latest-heading"
              eyebrow="Fresh from the Rift"
              title="Latest releases"
              href="/songs?sort=newest"
              linkLabel="Full library"
            />
            <SongGrid songs={latest.items} />
          </section>
        )}

        <AwardsTeaser awards={awards} stats={stats} />
      </div>
    </div>
  )
}

function dedupe(songs: ReadonlyArray<SongSummary>): Array<SongSummary> {
  const seen = new Set<string>()
  return songs.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

// ---------------------------------------------------------------------------

function Hero({
  stats,
  featured,
  featuredAnalysis,
  queue,
}: {
  readonly stats: ArchiveStats
  readonly featured: SongSummary | null
  readonly featuredAnalysis: Awaited<ReturnType<typeof getAnalysis>>
  readonly queue: ReadonlyArray<SongSummary>
}) {
  const span = stats.firstYear && stats.lastYear ? `${stats.firstYear}–${stats.lastYear}` : null
  const items: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: "songs", value: formatNumber(stats.songs) },
    { label: "artists", value: formatNumber(stats.artists) },
    { label: "music videos", value: formatNumber(stats.musicVideos) },
    { label: "hours of music", value: formatNumber(stats.hours) },
    { label: "awards won", value: formatNumber(stats.awardsWon) },
  ]
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden bg-riot-radial">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 pt-12 pb-14 md:px-6 md:pt-16">
        <div className="flex flex-col items-center text-center">
          <p className="mb-3 text-xs font-semibold tracking-[0.35em] text-gold uppercase">
            The complete archive{span ? ` · ${span}` : ""}
          </p>
          <h1 id="hero-heading" className="text-6xl leading-[0.9] text-balance sm:text-7xl md:text-8xl lg:text-[8.5rem]">
            The music of Riot&nbsp;Games
          </h1>
          <p className="mt-5 max-w-2xl text-base text-pretty text-muted-foreground md:text-lg">
            Worlds anthems, champion themes, cinematics, Arcane and every virtual band — playable, with the music video
            one click away, synced to the exact moment you are listening to.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/songs"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 text-sm font-medium transition-colors hover:border-gold/60 hover:text-gold"
            >
              <LibraryIcon className="size-4" /> Browse the library
            </Link>
            <SearchTrigger className="h-10 w-full max-w-72 rounded-full px-4 sm:w-72" />
          </div>
        </div>

        <HeroWaveform featured={featured} analysis={featuredAnalysis} queue={queue} />

        <dl className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-5">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-0.5 bg-[#0c1d2e]/95 px-3 py-4">
              <dt className="order-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">{item.label}</dt>
              <dd className="order-1 font-display text-4xl leading-none tracking-wide text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function CategoriesSection({
  categories,
  songs,
}: {
  readonly categories: ReadonlyArray<Category>
  /** Each category's most popular songs. */
  readonly songs: ReadonlyArray<ReadonlyArray<SongSummary>>
}) {
  const all = categories.map((c, i) => ({ category: c, songs: songs[i] ?? [] }))
  const withSongs = all.filter((x) => x.category.songCount > 0)
  const shown = withSongs.length > 0 ? withSongs : all
  // Songs sit in several categories, so each tile gets a cover no other tile shows (grid of up to 4 columns).
  const covers = distinctCovers(shown.map((x) => x.songs), 1, 4)
  const list = shown.map((x, i) => ({ category: x.category, top: covers[i]?.[0] ?? null }))
  if (list.length === 0) return null
  return (
    <section aria-labelledby="categories-heading">
      <SectionHeader id="categories-heading" eyebrow="Browse by" title="Categories" href="/categories" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {list.map(({ category, top }) => (
          <Link
            key={category.id}
            href={`/categories/${category.id}`}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <PaletteBackdrop
              palette={top?.palette ?? []}
              seed={category.id}
              className="flex aspect-[16/10] flex-col justify-end p-4 transition-transform duration-500 group-hover:scale-[1.02] md:p-5"
            >
              {top?.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- local /media file
                <img
                  src={top.coverUrl}
                  alt=""
                  loading="lazy"
                  className="absolute top-4 right-4 size-16 rounded-lg object-cover opacity-90 shadow-xl ring-1 ring-white/15 transition-transform duration-500 group-hover:-rotate-3 md:size-20"
                />
              )}
              <div className="relative">
                <h3 className={cn("font-display text-2xl leading-none tracking-wide md:text-3xl", top?.coverUrl && "pr-16 md:pr-20")}>
                  {category.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-white/75 md:text-sm">{category.description}</p>
                <p className="mt-2 text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
                  {pluralize(category.songCount, "song")}
                </p>
              </div>
            </PaletteBackdrop>
          </Link>
        ))}
      </div>
    </section>
  )
}

function GamesSection({ games }: { readonly games: ReadonlyArray<Game> }) {
  const list = games.filter((g) => g.songCount > 0)
  if (list.length === 0) return null
  return (
    <section aria-labelledby="games-heading">
      <SectionHeader id="games-heading" eyebrow="Across the universe" title="Games" href="/games" />
      <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        {list.map((game) => (
          <Link
            key={game.id}
            href={`/games/${game.id}`}
            className="group relative flex min-w-52 shrink-0 flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-card/50 p-4 transition-colors hover:border-white/20 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="absolute -top-10 -right-10 size-32 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-50"
              style={{ backgroundColor: game.color }}
            />
            <span
              className="relative font-display text-4xl leading-none tracking-wide"
              style={{ color: game.color }}
            >
              {game.short}
            </span>
            <span className="relative">
              <span className="block text-sm font-semibold">{game.name}</span>
              <span className="text-xs text-muted-foreground">{pluralize(game.songCount, "song")}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function AwardsTeaser({ awards, stats }: { readonly awards: ReadonlyArray<Award>; readonly stats: ArchiveStats }) {
  const won = awards.filter((a) => a.result === "won")
  const nominated = awards.length - won.length
  const highlights = [...won].sort((a, b) => Number(b.musicRelated) - Number(a.musicRelated) || b.year - a.year).slice(0, 3)
  return (
    <section aria-labelledby="awards-heading">
      <div className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-br from-[#1a2f45] via-[#10243a] to-[#0c1d2e] p-6 md:p-10">
        <TrophyIcon aria-hidden className="absolute -right-6 -bottom-8 size-56 text-gold/[0.07]" />
        <div className="relative grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.3em] text-gold uppercase">Recognition</p>
            <h2 id="awards-heading" className="text-5xl leading-none md:text-6xl">
              Awards &amp; honours
            </h2>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              From the Emmys to The Game Awards: the trophies and nominations Riot&apos;s music, shows and cinematics
              have collected.
            </p>
            <div className="mt-5 flex items-center gap-6">
              <div>
                <p className="font-display text-5xl leading-none text-gold">{formatNumber(stats.awardsWon || won.length)}</p>
                <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">won</p>
              </div>
              <div>
                <p className="font-display text-5xl leading-none">{formatNumber(nominated)}</p>
                <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">nominations</p>
              </div>
            </div>
            <a
              href="/awards"
              className="group mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-gold px-5 text-sm font-semibold text-[#0c1d2e] transition-colors hover:bg-[#d8ad52]"
            >
              Explore the awards <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
          <ul className="flex flex-col gap-2">
            {highlights.length === 0 && (
              <li className="rounded-xl border border-white/[0.07] bg-black/15 p-4 text-sm text-muted-foreground">
                The awards research is still being compiled.
              </li>
            )}
            {highlights.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-4">
                <TrophyIcon className="mt-0.5 size-4 shrink-0 text-gold" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {a.award} <span className="font-normal text-muted-foreground">· {a.year}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.organization} — {a.songTitle ?? a.project}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function HomeWithoutDatabase() {
  return (
    <div className="flex flex-col">
      <section className="relative overflow-hidden bg-riot-radial">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-8 px-4 pt-14 pb-6 text-center md:px-6">
          <p className="text-xs font-semibold tracking-[0.35em] text-gold uppercase">The complete archive</p>
          <h1 className="text-6xl leading-[0.9] text-balance sm:text-7xl md:text-8xl">The music of Riot&nbsp;Games</h1>
          <Waveform variant="hero" seed="riot-games-music-archive" className={cn("h-40 w-full md:h-56")} aria-label="Decorative waveform" />
        </div>
      </section>
      <DatabaseMissing />
    </div>
  )
}
