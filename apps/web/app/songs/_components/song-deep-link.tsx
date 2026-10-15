"use client"

import * as React from "react"
import { toast } from "sonner"
import type { SongSummary } from "@workspace/db/domain/types"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { usePlayer, type PlayerContextValue } from "@/components/player/player-provider"

/**
 * Deep links into a song page (the /impact stories link here this way):
 *
 * - `?t=<songSeconds>` → play the song from that moment (seek when it is
 *   already the current song);
 * - `?vt=<videoSeconds>&watch=1` → open the music-video popup at that *video*
 *   time (the popup maps it back to the song through the audio alignment);
 * - `?t=<songSeconds>&watch=1` → open the popup synced to that song moment.
 *
 * Runs once per distinct link. The player's `<audio>` element is created in
 * the provider's mount effect, which runs *after* this child's effects on a
 * full page load, so the action waits (a few ms at most) for it.
 */
export function SongDeepLink({
  song,
  queue,
  t,
  vt,
  watch,
}: {
  readonly song: SongSummary
  readonly queue: ReadonlyArray<SongSummary>
  readonly t: number | null
  readonly vt: number | null
  readonly watch: boolean
}) {
  const player = usePlayer()
  const playerRef = React.useRef<PlayerContextValue>(player)
  playerRef.current = player
  const handled = React.useRef<string | null>(null)
  const key = `${song.id}|${t ?? ""}|${vt ?? ""}|${watch ? 1 : 0}`

  React.useEffect(() => {
    if (t === null && vt === null && !watch) return
    if (handled.current === key) return

    // Timers, not requestAnimationFrame: rAF does not fire in tabs that are not painting.
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const p = playerRef.current
      if (!p.getAudioElement()) {
        // Provider not mounted yet: retry for ~1.5 s, then go ahead anyway.
        if (++attempts < 50) {
          timer = setTimeout(run, 30)
          return
        }
      }
      // Marked here, not when scheduling, so a StrictMode effect replay still runs it once.
      handled.current = key
      const isCurrent = p.song?.id === song.id
      if (watch) {
        if (!song.hasVideo) {
          toast(`“${song.title}” has no downloaded music video`, {
            id: `deeplink-${song.id}`,
            description: t !== null ? `Playing the song from ${formatDuration(t)} instead.` : undefined,
          })
          if (t !== null && song.audioUrl) p.playAt(song, t, isCurrent ? undefined : queue)
          return
        }
        if (vt !== null) p.openVideo({ videoTime: Math.max(0, vt), ...(isCurrent ? {} : { song }) })
        else p.openVideo({ songTime: Math.max(0, t ?? 0), ...(isCurrent ? {} : { song }) })
        return
      }
      if (t !== null && song.audioUrl) {
        p.playAt(song, Math.max(0, t), isCurrent ? undefined : queue)
        toast(`Playing “${song.title}” from ${formatDuration(t)}`, { id: `deeplink-${song.id}` })
      }
    }
    timer = setTimeout(run, 0)
    return () => clearTimeout(timer)
    // `key` captures every input; the player is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return null
}
