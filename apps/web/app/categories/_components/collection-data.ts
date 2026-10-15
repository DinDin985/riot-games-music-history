import "server-only"

import { cache } from "react"
import type { SongSummary } from "@workspace/db/domain/types"
import { distinctCovers } from "@/lib/artwork"
import { listSongs } from "@/lib/server/repo"

/**
 * Server-side helpers shared by /categories and /games (and their detail pages):
 * the whole catalogue in popularity order (one cached SQLite read per request)
 * and per-collection aggregates computed from it.
 */

const BATCH = 1000

/** Every song, most popular first (same order as `/songs`). Request-deduplicated. */
export const getAllSongs = cache(async (): Promise<ReadonlyArray<SongSummary>> => {
  const first = await listSongs({ sort: "popular", limit: BATCH, offset: 0 })
  const items = [...first.items]
  while (items.length < first.total) {
    const next = await listSongs({
      sort: "popular",
      limit: BATCH,
      offset: items.length,
    })
    if (next.items.length === 0) break
    items.push(...next.items)
  }
  return items
})

export interface Count {
  readonly id: string
  readonly count: number
}

export interface CollectionStats {
  readonly songCount: number
  readonly videoCount: number
  readonly playableCount: number
  readonly firstYear: number | null
  readonly lastYear: number | null
  readonly totalViews: number
  readonly totalSeconds: number
  /** Most songs first. */
  readonly byGame: ReadonlyArray<Count>
  /** Most songs first (every category a song is tagged with). */
  readonly byCategory: ReadonlyArray<Count>
  /** Oldest first. */
  readonly byYear: ReadonlyArray<{
    readonly year: number
    readonly count: number
  }>
  /** The most popular songs (input order), preferring ones with artwork, never two with the same picture. */
  readonly top: ReadonlyArray<SongSummary>
}

function counts(values: Iterable<string>): Array<Count> {
  const map = new Map<string, number>()
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1)
  return [...map].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

/** Aggregates for a list of songs that is already in popularity order. */
export function collectionStats(songs: ReadonlyArray<SongSummary>, topCount = 5): CollectionStats {
  let firstYear: number | null = null
  let lastYear: number | null = null
  let totalViews = 0
  let totalSeconds = 0
  const years = new Map<number, number>()
  for (const s of songs) {
    if (s.year !== null) {
      firstYear = firstYear === null ? s.year : Math.min(firstYear, s.year)
      lastYear = lastYear === null ? s.year : Math.max(lastYear, s.year)
      years.set(s.year, (years.get(s.year) ?? 0) + 1)
    }
    totalViews += s.viewCount ?? 0
    totalSeconds += s.duration ?? 0
  }
  return {
    songCount: songs.length,
    videoCount: songs.filter((s) => s.hasVideo).length,
    playableCount: songs.filter((s) => s.audioUrl).length,
    firstYear,
    lastYear,
    totalViews,
    totalSeconds,
    byGame: counts(songs.map((s) => s.gameId).filter(Boolean)),
    byCategory: counts(songs.flatMap((s) => (s.categoryIds.length > 0 ? s.categoryIds : [s.primaryCategoryId]))),
    byYear: [...years].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
    top: distinctCovers([songs], topCount, 0)[0] ?? [],
  }
}

/** "2012–2026", "2019", or null. */
export function yearSpan(first: number | null, last: number | null): string | null {
  if (first === null || last === null) return null
  return first === last ? String(first) : `${first}–${last}`
}

/** Ids are kebab-case slugs; anything else cannot exist. */
export function isSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,100}$/i.test(value)
}

/** Read one string search param (first value of an array). */
export function searchParam(
  params: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>,
  key: string,
): string | undefined {
  const v = params[key]
  const s = Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined)
  return s === undefined || s === "" ? undefined : s
}

/** 1-based page number from `?page=`, clamped to [1, pageCount]. */
export function pageParam(
  params: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>,
  pageCount: number,
): number {
  const n = Number.parseInt(searchParam(params, "page") ?? "1", 10)
  return Math.min(Math.max(1, Number.isFinite(n) ? n : 1), Math.max(1, pageCount))
}
