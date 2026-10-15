import type { TimelineEntryDetail, TimelinePayload } from "@workspace/db/domain/timeline"
import { ApiRequestError } from "@/lib/api-client"

/**
 * Browser-side helpers for `/api/timeline` (see app/api/timeline). They throw
 * `ApiRequestError` on failures — code `database-missing` (503) until
 * `npm run pipeline -- timeline` has built data/timeline.json. Pass an
 * `AbortSignal` to cancel stale requests.
 */

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

/** Every timeline entry (slim), the vinyls and the tags. */
export async function fetchTimeline(signal?: AbortSignal): Promise<TimelinePayload> {
  const payload = await getJson<TimelinePayload>("/api/timeline", signal)
  if (!payload) throw new ApiRequestError(404, "not-found", "The timeline API is not available")
  return payload
}

/** The detail panel data for one entry; null when the id is unknown. */
export const fetchTimelineEntry = (id: string, signal?: AbortSignal): Promise<TimelineEntryDetail | null> =>
  getJson<TimelineEntryDetail>(`/api/timeline/${encodeURIComponent(id)}`, signal)
