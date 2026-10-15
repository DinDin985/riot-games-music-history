"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { usePlayer } from "@/components/player/player-provider"
import { fetchSongsByIds } from "@/lib/api-client"

/**
 * Deep links into the synced music video:
 *
 *   /songs/<id>?watch=1&vt=187   → open the MV at video time 3:07 (curated key moment, e.g. the /impact pages)
 *   /songs/<id>?watch=1&st=95    → open the MV at the moment matching song time 1:35
 *   /songs/<id>?watch=1          → open the MV from the start of the song
 *
 * Times accept seconds (`187`, `187.5`) or clock form (`3:07`). The `watch`,
 * `vt` and `st` parameters are removed from the address once handled, so a
 * reload does not pop the video up again.
 *
 * Uses `useSearchParams`, so render the caller inside a `<Suspense>` boundary.
 */
export function useWatchDeepLink(): void {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const watch = searchParams?.get("watch") ?? null
  const { openVideo } = usePlayer()
  const openRef = React.useRef(openVideo)
  React.useLayoutEffect(() => {
    openRef.current = openVideo
  })
  const handled = React.useRef<string | null>(null)

  React.useEffect(() => {
    const match = /^\/songs\/([^/]+)\/?$/.exec(pathname ?? "")
    if (!match) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("watch") !== "1") return
    const href = window.location.href
    if (handled.current === href) return
    handled.current = href

    let id: string
    try {
      id = decodeURIComponent(match[1]!)
    } catch {
      return
    }
    const videoTime = parseSeconds(params.get("vt"))
    const songTime = parseSeconds(params.get("st"))
    params.delete("watch")
    params.delete("vt")
    params.delete("st")
    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    )

    // Not aborted on cleanup on purpose: the link is consumed once (StrictMode re-runs effects).
    fetchSongsByIds([id])
      .then(([song]) => {
        if (!song?.hasVideo) return
        openRef.current({
          song,
          ...(videoTime !== null ? { videoTime } : { songTime: songTime ?? 0 }),
        })
      })
      .catch(() => undefined)
    // `watch` re-runs the effect on same-page navigations that only change the query.
  }, [pathname, watch])
}

/** `"187"`, `"187.5"`, `"3:07"`, `"1:02:05"` → seconds; anything else → null. */
export function parseSeconds(value: string | null): number | null {
  if (value === null) return null
  const v = value.trim()
  if (/^\d+(\.\d+)?s?$/.test(v)) return Number.parseFloat(v)
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(v)) {
    return v.split(":").reduce((acc, part) => acc * 60 + Number.parseFloat(part), 0)
  }
  return null
}
