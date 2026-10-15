import type { NextRequest } from "next/server"
import type { SearchResults } from "@/lib/api-client"
import { listArtists, listSongs } from "@/lib/server/repo"
import { handle, json } from "@/lib/server/http"

/**
 * GET /api/search?q=… → quick search for the ⌘K palette: up to `limit`
 * (default 8, max 25) songs (by popularity) and 6 artists.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams
    const q = (params.get("q") ?? "").trim().slice(0, 100)
    const limit = Math.min(25, Math.max(1, Number.parseInt(params.get("limit") ?? "8", 10) || 8))
    if (q.length === 0) return json<SearchResults>({ q, songs: [], artists: [], totalSongs: 0 })
    const [songs, artists] = await Promise.all([listSongs({ q, limit, sort: "popular" }), listArtists({ q })])
    return json<SearchResults>(
      { q, songs: songs.items, artists: artists.slice(0, 6), totalSongs: songs.total },
      { maxAge: 30 },
    )
  })
}
