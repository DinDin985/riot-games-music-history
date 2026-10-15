import "server-only"

import { isDatabaseMissing } from "@/lib/server/repo"

/** JSON error body returned by every `/api/*` route. */
export interface ApiError {
  readonly error: "database-missing" | "not-found" | "bad-request" | "internal"
  readonly message: string
}

export function json<A>(data: A, init: ResponseInit & { readonly maxAge?: number } = {}): Response {
  const { maxAge = 0, headers, ...rest } = init
  const h = new Headers(headers)
  if (!h.has("Cache-Control")) {
    // Short private caching: the DB only changes when the pipeline rebuilds it.
    h.set("Cache-Control", maxAge > 0 ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 10}` : "no-store")
  }
  return Response.json(data, { ...rest, headers: h })
}

export function apiError(status: number, error: ApiError["error"], message: string): Response {
  return json<ApiError>({ error, message }, { status })
}

export const notFound = (what: string) => apiError(404, "not-found", `${what} not found`)

/** Run a route body, mapping a missing database to 503 and other failures to 500. */
export async function handle(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body()
  } catch (error) {
    if (isDatabaseMissing(error)) {
      return apiError(503, "database-missing", "The archive database has not been built yet. Run `npm run pipeline -- build-db`.")
    }
    console.error("[api]", error)
    return apiError(500, "internal", error instanceof Error ? error.message : "Unexpected error")
  }
}

/** decodeURIComponent that never throws (route params may or may not arrive encoded). */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
