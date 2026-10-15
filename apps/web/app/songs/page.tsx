import type { Metadata } from "next"
import type { ArchiveStats, SongSummary } from "@workspace/db/domain/types"
import { formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { DatabaseMissing } from "@/components/database-missing"
import { PlayAllButton } from "@/components/songs/play-button"
import { SongGrid } from "@/components/songs/song-grid"
import { SongList } from "@/components/songs/song-row"
import {
  getArtist,
  getCategories,
  getGames,
  getStats,
  getYears,
  hasDatabase,
  listSongs,
  orFallback,
} from "@/lib/server/repo"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"
import { NoResults, PageOutOfRange, type Relaxation } from "./_components/library-empty"
import { LibraryFilters } from "./_components/library-filters"
import { LibraryPagination } from "./_components/library-pagination"
import {
  LIBRARY_PAGE_SIZE,
  SORT_LABELS,
  activeFilterCount,
  parseLibraryState,
  toSongFilter,
  type LibraryState,
} from "./_components/library-params"
import { LibraryTransitionProvider, PendingResults } from "./_components/library-transition"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const RESULTS_ID = "library-results"

/** Resolve the artist filter's display name (null when unknown or no DB). */
async function artistNameOf(id: string | null): Promise<string | null> {
  if (!id || !hasDatabase()) return null
  const artist = await orFallback(getArtist(id), null)
  return artist?.name ?? null
}

/** Page title for the active filters, most specific first. */
function libraryTitle(state: LibraryState, artistName: string | null): string {
  if (state.category) return categoryInfo(state.category).name
  if (state.game) return gameInfo(state.game).name
  if (state.artist) return artistName ?? "Artist"
  if (state.q) return `“${state.q}”`
  if (state.year !== null) return `${state.year}`
  return "The Library"
}

/** "Worlds Songs from League of Legends in 2017 with a music video matching “rise”". */
function describeFilters(state: LibraryState, artistName: string | null): string {
  const parts: Array<string> = []
  if (state.category) parts.push(`in ${categoryInfo(state.category).name}`)
  if (state.game) parts.push(`from ${gameInfo(state.game).name}`)
  if (state.artist) parts.push(`by ${artistName ?? state.artist}`)
  if (state.year !== null) parts.push(`released in ${state.year}`)
  if (state.video) parts.push("with a music video")
  if (state.q) parts.push(`matching “${state.q}”`)
  return parts.join(" ") || "in this view"
}

export async function generateMetadata({ searchParams }: { readonly searchParams: SearchParams }): Promise<Metadata> {
  const state = parseLibraryState(await searchParams)
  const artistName = await artistNameOf(state.artist)
  const title = libraryTitle(state, artistName)
  return {
    title: title === "The Library" ? "Library" : `${title.replace(/[“”]/g, "")} · Library`,
    description:
      activeFilterCount(state) > 0
        ? `Riot Games songs ${describeFilters(state, artistName)} — playable, with moving waveforms and synced music videos.`
        : "Every song Riot Games has released, filterable by game, category, year and music video — all playable.",
  }
}

export default async function SongsPage({ searchParams }: { readonly searchParams: SearchParams }) {
  if (!hasDatabase()) return <DatabaseMissing />

  const state = parseLibraryState(await searchParams)
  const filter = toSongFilter(state)
  const [page, games, categories, years, stats, artistName] = await Promise.all([
    listSongs(filter),
    getGames(),
    getCategories(),
    getYears(),
    getStats(),
    artistNameOf(state.artist),
  ])

  const totalPages = Math.max(1, Math.ceil(page.total / LIBRARY_PAGE_SIZE))
  const from = page.total === 0 ? 0 : (state.page - 1) * LIBRARY_PAGE_SIZE + 1
  const to = Math.min(page.total, from + page.items.length - 1)
  const filtered = activeFilterCount(state) > 0

  // Empty result: count what each single relaxation would find (cheap COUNT queries).
  const relaxations: ReadonlyArray<Relaxation> =
    page.total === 0 && filtered ? await relaxationsFor(state, artistName) : []

  return (
    <LibraryTransitionProvider>
      <LibraryHeader
        state={state}
        artistName={artistName}
        total={page.total}
        stats={stats}
        playable={page.items}
      />

      <LibraryFilters
        state={state}
        games={games.filter((g) => g.songCount > 0).map((g) => ({ id: g.id, name: g.name, count: g.songCount }))}
        categories={categories.filter((c) => c.songCount > 0).map((c) => ({ id: c.id, name: c.name, count: c.songCount }))}
        years={[...years].sort((a, b) => b.year - a.year).map((y) => ({ year: y.year, count: y.songCount }))}
        artistName={artistName}
      />

      <div id={RESULTS_ID} className="mx-auto w-full max-w-[1600px] scroll-mt-36 px-4 pt-6 md:px-6">
        <PendingResults>
          {page.total > 0 && (
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <p aria-live="polite">
                {page.items.length > 0 ? (
                  <>
                    Showing <span className="text-foreground tabular-nums">{formatNumber(from)}</span>–
                    <span className="text-foreground tabular-nums">{formatNumber(to)}</span> of{" "}
                    <span className="text-foreground tabular-nums">{pluralize(page.total, "song")}</span>
                  </>
                ) : (
                  <>{pluralize(page.total, "song")}</>
                )}
              </p>
              <p className="text-xs">
                {SORT_LABELS[state.sort]}
                {totalPages > 1 && (
                  <>
                    {" "}· page <span className="tabular-nums">{Math.min(state.page, totalPages)}</span> of{" "}
                    <span className="tabular-nums">{totalPages}</span>
                  </>
                )}
              </p>
            </div>
          )}

          {page.total === 0 ? (
            filtered ? (
              <NoResults state={state} relaxations={relaxations} description={describeFilters(state, artistName)} />
            ) : (
              <DatabaseMissing title="The library is empty" />
            )
          ) : page.items.length === 0 ? (
            <PageOutOfRange state={state} totalPages={totalPages} />
          ) : state.view === "list" ? (
            <SongList
              songs={page.items}
              startIndex={from}
              className="rounded-2xl border border-white/[0.06] bg-card/30 p-1.5 md:p-2"
            />
          ) : (
            <SongGrid songs={page.items} priorityCount={6} />
          )}

          <LibraryPagination state={state} totalPages={totalPages} scrollTargetId={RESULTS_ID} />
        </PendingResults>
      </div>
    </LibraryTransitionProvider>
  )
}

function LibraryHeader({
  state,
  artistName,
  total,
  stats,
  playable,
}: {
  readonly state: LibraryState
  readonly artistName: string | null
  readonly total: number
  readonly stats: ArchiveStats
  readonly playable: ReadonlyArray<SongSummary>
}) {
  const title = libraryTitle(state, artistName)
  const filtered = activeFilterCount(state) > 0
  const eyebrow = state.category
    ? "Category"
    : state.game
      ? "Game"
      : state.artist
        ? "Artist"
        : state.q
          ? "Search"
          : state.year !== null
            ? "Year"
            : "Every song, one archive"
  const intro = state.category ? categoryInfo(state.category).description : ""
  const description = filtered
    ? `${pluralize(total, "song")} ${describeFilters(state, artistName)}.`
    : `${formatNumber(stats.songs)} songs, ${formatNumber(stats.musicVideos)} music videos and ${formatNumber(stats.hours)} hours of music${
          stats.firstYear && stats.lastYear ? ` from ${stats.firstYear} to ${stats.lastYear}` : ""
        } — filter by game, category or year and press play.`
  const hasPlayable = playable.some((s) => s.audioUrl)

  return (
    <section aria-labelledby="library-heading" className="relative overflow-hidden bg-riot-radial">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 pt-10 pb-7 md:flex-row md:items-end md:justify-between md:px-6 md:pt-14">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold tracking-[0.3em] text-gold uppercase">{eyebrow}</p>
          <h1 id="library-heading" className="truncate text-6xl leading-[0.9] md:text-7xl lg:text-8xl">
            {title}
          </h1>
          {intro && <p className="mt-3 max-w-2xl text-sm text-pretty text-foreground/80 md:text-base">{intro}</p>}
          <p className={cn("max-w-2xl text-sm text-pretty text-muted-foreground", intro ? "mt-1" : "mt-3 md:text-base")}>
            {description}
          </p>
        </div>
        {hasPlayable && (
          <div className="flex shrink-0 items-center gap-2">
            <PlayAllButton songs={playable} className="h-11 bg-white px-6 text-[#0c1d2e] hover:bg-gold">
              Play {playable.length < total ? "this page" : "all"}
            </PlayAllButton>
            <PlayAllButton songs={playable} shuffle className="h-11 border-white/15 bg-white/[0.04] px-5" />
          </div>
        )}
      </div>
    </section>
  )
}

async function relaxationsFor(state: LibraryState, artistName: string | null): Promise<ReadonlyArray<Relaxation>> {
  const candidates: Array<{ readonly label: string; readonly patch: Partial<LibraryState> }> = []
  if (state.q) candidates.push({ label: `Drop the search “${state.q}”`, patch: { q: "" } })
  if (state.video) candidates.push({ label: "Include songs without a video", patch: { video: false } })
  if (state.year !== null) candidates.push({ label: `Any year, not ${state.year}`, patch: { year: null } })
  if (state.category) candidates.push({ label: `Any category, not ${categoryInfo(state.category).name}`, patch: { category: null } })
  if (state.game) candidates.push({ label: `Any game, not ${gameInfo(state.game).name}`, patch: { game: null } })
  if (state.artist) candidates.push({ label: `Any artist, not ${artistName ?? state.artist}`, patch: { artist: null } })
  return Promise.all(
    candidates.map(async (c) => {
      const next = { ...state, ...c.patch, page: 1 }
      const { total } = await listSongs({ ...toSongFilter(next), limit: 1, offset: 0 })
      return { ...c, count: total }
    }),
  )
}
