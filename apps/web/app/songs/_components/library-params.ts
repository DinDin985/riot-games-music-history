import type { SongFilter, SongSort } from "@workspace/db/domain/types"
import { SONG_SORTS, parseSongFilter } from "@/lib/song-filter"

/**
 * URL state of the /songs library — pure, shared by the Server Component page
 * (parsing `searchParams`) and the client filter bar (building hrefs).
 *
 * Params: `q`, `game`, `category`, `artist`, `year`, `video` (1 = only songs
 * with a downloaded music video; `hasVideo` is accepted too), `sort`
 * (popular|newest|oldest|title), `view` (grid|list), `page` (1-based).
 */
export type LibraryView = "grid" | "list"

export interface LibraryState {
  readonly q: string
  readonly game: string | null
  readonly category: string | null
  readonly artist: string | null
  readonly year: number | null
  readonly video: boolean
  readonly sort: SongSort
  readonly view: LibraryView
  readonly page: number
}

export const LIBRARY_PAGE_SIZE = 48

export const DEFAULT_LIBRARY_STATE: LibraryState = {
  q: "",
  game: null,
  category: null,
  artist: null,
  year: null,
  video: false,
  sort: "popular",
  view: "grid",
  page: 1,
}

export const SORT_LABELS: Readonly<Record<SongSort, string>> = {
  popular: "Most popular",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A–Z",
}

type RawParams = Readonly<Record<string, string | ReadonlyArray<string> | undefined>>

const first = (value: string | ReadonlyArray<string> | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : (value as string | undefined)
  return v === undefined || v === "" ? undefined : v
}

export function parseLibraryState(params: RawParams): LibraryState {
  const video = first(params.video) ?? first(params.hasVideo)
  // Reuse the API's validation (slug ids, sane years, known sorts, trimmed query).
  const filter = parseSongFilter({ ...params, hasVideo: video, page: undefined, offset: undefined, limit: undefined })
  const pageRaw = Number.parseInt(first(params.page) ?? "1", 10)
  const sort = filter.sort && SONG_SORTS.includes(filter.sort) ? filter.sort : "popular"
  return {
    q: filter.q ?? "",
    game: filter.game ?? null,
    category: filter.category ?? null,
    artist: filter.artist ?? null,
    year: filter.year ?? null,
    video: filter.hasVideo === true,
    sort,
    view: first(params.view) === "list" ? "list" : "grid",
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? Math.min(pageRaw, 10_000) : 1,
  }
}

/** `SongFilter` for `repo.listSongs` (one page). */
export function toSongFilter(state: LibraryState, pageSize = LIBRARY_PAGE_SIZE): SongFilter {
  return {
    q: state.q || undefined,
    game: state.game ?? undefined,
    category: state.category ?? undefined,
    artist: state.artist ?? undefined,
    year: state.year ?? undefined,
    hasVideo: state.video || undefined,
    sort: state.sort,
    limit: pageSize,
    offset: (state.page - 1) * pageSize,
  }
}

/** Number of active filters (search included; sort / view / page are not filters). */
export function activeFilterCount(state: LibraryState): number {
  return [state.q, state.game, state.category, state.artist, state.year, state.video].filter(Boolean).length
}

/**
 * `/songs?…` for `state` with `patch` applied. Any change other than `page`
 * itself (or `view`) goes back to page 1. Defaults are omitted from the URL.
 */
export function libraryHref(state: LibraryState, patch: Partial<LibraryState> = {}): string {
  const resetsPage = Object.keys(patch).some((k) => k !== "page" && k !== "view")
  const next: LibraryState = { ...state, ...patch, page: patch.page ?? (resetsPage ? 1 : state.page) }
  const params = new URLSearchParams()
  if (next.q) params.set("q", next.q)
  if (next.game) params.set("game", next.game)
  if (next.category) params.set("category", next.category)
  if (next.artist) params.set("artist", next.artist)
  if (next.year !== null) params.set("year", String(next.year))
  if (next.video) params.set("video", "1")
  if (next.sort !== "popular") params.set("sort", next.sort)
  if (next.view !== "grid") params.set("view", next.view)
  if (next.page > 1) params.set("page", String(next.page))
  const qs = params.toString()
  return qs ? `/songs?${qs}` : "/songs"
}

/** Page numbers to show, with `null` for an ellipsis: 1 … 4 5 [6] 7 8 … 19. */
export function pageWindow(current: number, total: number, radius = 1): ReadonlyArray<number | null> {
  if (total <= 1) return [1]
  const pages = new Set<number>([1, total])
  for (let p = current - radius; p <= current + radius; p++) if (p >= 1 && p <= total) pages.add(p)
  // Avoid a lonely ellipsis that hides a single page.
  if (current - radius === 3) pages.add(2)
  if (current + radius === total - 2) pages.add(total - 1)
  const sorted = [...pages].sort((a, b) => a - b)
  const out: Array<number | null> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) out.push(null)
    out.push(sorted[i]!)
  }
  return out
}
