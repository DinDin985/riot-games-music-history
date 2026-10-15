import type { SongFilter, SongSort } from "@workspace/db/domain/types"

/**
 * Query string ⇄ `SongFilter`, shared by `/api/songs` and the library pages.
 *
 * Accepts `URLSearchParams` (route handlers) or the awaited `searchParams`
 * object of a page (`Record<string, string | string[] | undefined>`).
 *
 * Params: `q`, `game`, `category`, `artist`, `year`, `hasVideo` (1/true),
 * `sort` (popular|newest|oldest|title), `limit` (1–200), `offset`, `page`
 * (1-based, converted to an offset using `limit`).
 */
export type QueryInput = URLSearchParams | Readonly<Record<string, string | ReadonlyArray<string> | undefined>>

export const SONG_SORTS: ReadonlyArray<SongSort> = ["popular", "newest", "oldest", "title"]
export const DEFAULT_PAGE_SIZE = 48
export const MAX_PAGE_SIZE = 200

function get(input: QueryInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined
  const v = input[key]
  const s = Array.isArray(v) ? v[0] : (v as string | undefined)
  return s === undefined || s === "" ? undefined : s
}

function int(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : undefined
}

function slug(value: string | undefined): string | undefined {
  // Ids are kebab-case slugs; anything else cannot match and is ignored.
  return value && /^[a-z0-9][a-z0-9-]{0,100}$/i.test(value) ? value.toLowerCase() : undefined
}

export function parseSongFilter(input: QueryInput, defaults: SongFilter = {}): SongFilter {
  const q = get(input, "q")?.trim().slice(0, 100)
  const sortRaw = get(input, "sort")
  const sort = SONG_SORTS.includes(sortRaw as SongSort) ? (sortRaw as SongSort) : defaults.sort
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, int(get(input, "limit")) ?? defaults.limit ?? DEFAULT_PAGE_SIZE))
  const page = int(get(input, "page"))
  const offset = Math.max(0, int(get(input, "offset")) ?? (page && page > 1 ? (page - 1) * limit : (defaults.offset ?? 0)))
  const year = int(get(input, "year"))
  const hasVideo = get(input, "hasVideo")
  return {
    ...defaults,
    q: q || defaults.q,
    game: slug(get(input, "game")) ?? defaults.game,
    category: slug(get(input, "category")) ?? defaults.category,
    artist: slug(get(input, "artist")) ?? defaults.artist,
    year: year !== undefined && year > 1990 && year < 2200 ? year : defaults.year,
    hasVideo: hasVideo === undefined ? defaults.hasVideo : hasVideo === "1" || hasVideo === "true",
    sort,
    limit,
    offset,
  }
}

/** Inverse of `parseSongFilter` (omits defaults) — for links and fetches. */
export function songFilterToSearchParams(filter: SongFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.q) params.set("q", filter.q)
  if (filter.game) params.set("game", filter.game)
  if (filter.category) params.set("category", filter.category)
  if (filter.artist) params.set("artist", filter.artist)
  if (filter.year !== undefined) params.set("year", String(filter.year))
  if (filter.hasVideo) params.set("hasVideo", "1")
  if (filter.sort && filter.sort !== "popular") params.set("sort", filter.sort)
  if (filter.limit !== undefined && filter.limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(filter.limit))
  if (filter.offset) params.set("offset", String(filter.offset))
  return params
}
