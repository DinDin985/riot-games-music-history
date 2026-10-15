import { connection, type NextRequest } from "next/server"
import type { TimelineEntryDetail } from "@workspace/db/domain/timeline"
import { apiError, handle, json, notFound, safeDecode } from "@/lib/server/http"
import { getTimelineEntry, isTimelineMissing } from "@/lib/server/timeline"

/**
 * GET /api/timeline/:id → `TimelineEntryDetail` for one entry (a catalog song
 * id or an `x-…` extra): background, credits, music video, sources. 404 when
 * unknown, 503 until `npm run pipeline -- timeline` has run.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  return handle(async () => {
    const id = safeDecode((await ctx.params).id)
    try {
      const entry = id.length > 0 && id.length <= 200 ? await getTimelineEntry(id) : null
      return entry ? json<TimelineEntryDetail>(entry, { maxAge: 30 }) : notFound(`Timeline entry "${id}"`)
    } catch (error) {
      if (isTimelineMissing(error)) {
        return apiError(
          503,
          "database-missing",
          "The timeline has not been built yet. Run `npm run pipeline -- timeline` to create data/timeline.json.",
        )
      }
      throw error
    }
  })
}
