import type { Alignment } from "@workspace/db/domain/alignment"
import type { ArtistSummary, Page, SongAnalysis, SongDetail, SongFilter, SongSummary } from "@workspace/db/domain/types"
import { songFilterToSearchParams } from "@/lib/song-filter"

/**
 * Browser-side helpers for the JSON API (`app/api/*`). All of them resolve to
 * `null` on 404 and throw `ApiRequestError` on other failures. Pass an
 * `AbortSignal` to cancel stale requests.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiRequestError"
  }
}

async function getJson<A>(url: string, signal?: AbortSignal): Promise<A | null> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } })
  if (res.status === 404) return null
  if (!res.ok) {
    let code = "internal"
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      // not JSON
    }
    throw new ApiRequestError(res.status, code, message)
  }
  return (await res.json()) as A
}

const enc = encodeURIComponent

export const fetchSong = (id: string, signal?: AbortSignal) => getJson<SongDetail>(`/api/songs/${enc(id)}`, signal)

export const fetchSongAnalysis = (id: string, signal?: AbortSignal) =>
  getJson<SongAnalysis>(`/api/songs/${enc(id)}/analysis`, signal)

export const fetchSongAlignment = (id: string, signal?: AbortSignal) =>
  getJson<Alignment>(`/api/songs/${enc(id)}/alignment`, signal)

export async function fetchSongs(filter: SongFilter, signal?: AbortSignal): Promise<Page<SongSummary>> {
  return (await getJson<Page<SongSummary>>(`/api/songs?${songFilterToSearchParams(filter)}`, signal)) ?? { items: [], total: 0 }
}

/** Summaries for exactly these ids, in order (unknown ids skipped). */
export async function fetchSongsByIds(ids: ReadonlyArray<string>, signal?: AbortSignal): Promise<ReadonlyArray<SongSummary>> {
  if (ids.length === 0) return []
  const page = await getJson<Page<SongSummary>>(`/api/songs?ids=${ids.map(enc).join(",")}`, signal)
  return page?.items ?? []
}

export interface SearchResults {
  readonly q: string
  readonly songs: ReadonlyArray<SongSummary>
  readonly artists: ReadonlyArray<ArtistSummary>
  readonly totalSongs: number
}

export async function searchArchive(q: string, signal?: AbortSignal, limit = 8): Promise<SearchResults> {
  return (
    (await getJson<SearchResults>(`/api/search?q=${enc(q)}&limit=${limit}`, signal)) ?? {
      q,
      songs: [],
      artists: [],
      totalSongs: 0,
    }
  )
}
