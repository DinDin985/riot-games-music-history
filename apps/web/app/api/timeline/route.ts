import { connection } from "next/server"
import type { TimelinePayload } from "@workspace/db/domain/timeline"
import { apiError, handle, json } from "@/lib/server/http"
import { getTimelinePayload, isTimelineMissing } from "@/lib/server/timeline"

/**
 * GET /api/timeline → `TimelinePayload`: every timeline entry (slim, sorted by
 * date), the vinyls and the tag vocabulary. Details come from
 * `/api/timeline/:id`. 503 until `npm run pipeline -- timeline` has run.
 */
export async function GET() {
  // Read data/timeline.json per request (memoised by mtime), never prerendered at build time.
  await connection()
  return handle(async () => {
    try {
      return json<TimelinePayload>(await getTimelinePayload(), { maxAge: 30 })
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
