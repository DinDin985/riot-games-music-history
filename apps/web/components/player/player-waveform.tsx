"use client"

import * as React from "react"
import type { SongAnalysis, SongSummary } from "@workspace/db/domain/types"
import { Waveform, type WaveformProps } from "@workspace/ui/components/riot/waveform"
import { usePlayer } from "@/components/player/player-provider"

/**
 * `<Waveform>` wired to the global player.
 *
 * - No `song`, or `song` is the loaded song → follows playback: live analyser
 *   while playing, scrolling peaks + beat pulses, idle breathing when paused;
 *   click/drag seeks (when `seekable`).
 * - Another song → shows that song's `analysis` (pass it from the server).
 *   With `preview`, a virtual clock loops its chorus so the shape moves before
 *   anything is played; clicking starts that song at the clicked moment.
 */
export interface PlayerWaveformProps
  extends Omit<
    WaveformProps,
    "peaks" | "peaksRate" | "beats" | "getTime" | "time" | "playing" | "getAnalyser" | "getFrequencyData" | "onSeek" | "duration"
  > {
  readonly song?: SongSummary | null
  /** Analysis of `song` when it is not the current song (the current song's comes from the player). */
  readonly analysis?: SongAnalysis | null
  /** Loop the chorus of a non-current song (default false). */
  readonly preview?: boolean
  /** Click / drag to seek (default true). */
  readonly seekable?: boolean
}

export function PlayerWaveform({ song, analysis, preview = false, seekable = true, seed, ...props }: PlayerWaveformProps) {
  const player = usePlayer()
  const isCurrent = !song || song.id === player.song?.id
  const shown = isCurrent ? player.song : song
  const data = isCurrent ? (player.analysis ?? (analysis?.songId === player.song?.id ? analysis : null)) : (analysis ?? null)
  const duration = isCurrent ? player.duration || (shown?.duration ?? 0) : (shown?.duration ?? 0)

  // Virtual clock for previews: loops the chorus (or a slice of the song).
  const previewClock = React.useMemo(() => {
    const start = data?.chorusStart ?? (duration > 0 ? duration * 0.3 : 30)
    const end = data?.chorusEnd && data.chorusEnd > start + 4 ? data.chorusEnd : start + 30
    const t0 = typeof performance === "undefined" ? 0 : performance.now()
    return () => start + (((performance.now() - t0) / 1000) % (end - start))
  }, [data?.chorusStart, data?.chorusEnd, duration])

  const getAnalyser = React.useCallback(() => player.analyser, [player.analyser])

  if (isCurrent) {
    return (
      <Waveform
        peaks={data?.peaks}
        peaksRate={data?.peaksRate}
        beats={data?.beats}
        getTime={player.getCurrentTime}
        playing={player.isPlaying}
        getAnalyser={getAnalyser}
        duration={duration}
        seed={seed ?? shown?.id}
        onSeek={seekable && shown ? player.seek : undefined}
        {...props}
      />
    )
  }

  return (
    <Waveform
      peaks={data?.peaks}
      peaksRate={data?.peaksRate}
      beats={data?.beats}
      getTime={preview ? previewClock : undefined}
      time={data?.chorusStart ?? 0}
      playing={preview}
      duration={duration}
      seed={seed ?? shown?.id}
      onSeek={seekable && shown?.audioUrl ? (t) => player.playAt(shown, t) : undefined}
      {...props}
    />
  )
}
