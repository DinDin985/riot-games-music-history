import type { NextRequest } from "next/server"
import type { Page, SongSummary } from "@workspace/db/domain/types"
import { getSongsByIds, listSongs } from "@/lib/server/repo"
import { handle, json } from "@/lib/server/http"
import { parseSongFilter } from "@/lib/song-filter"

/**
 * GET /api/songs → `Page<SongSummary>`
 *
 * Query: see `parseSongFilter` (q, game, category, artist, year, hasVideo,
 * sort, limit, offset, page). `ids=a,b,c` instead returns exactly those songs
 * in that order (used to restore the player queue).
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams
    const ids = params.get("ids")
    if (ids !== null) {
      const list = ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 200)
        .slice(0, 500)
      const items = await getSongsByIds(list)
      return json<Page<SongSummary>>({ items, total: items.length }, { maxAge: 30 })
    }
    const page = await listSongs(parseSongFilter(params))
    return json<Page<SongSummary>>(page, { maxAge: 30 })
  })
}
