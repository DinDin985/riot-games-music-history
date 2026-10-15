/**
 * Large waveform for one song (story hero), bound to the shared page player:
 * it moves with the music while this song plays and breathes while idle.
 * Clicking it seeks (or starts the song at that point).
 */
import { useCallback } from "react"
import { Waveform, type WaveformVariant } from "@workspace/ui/components/riot/waveform"
import type { PlayerTrack } from "../../lib/types.ts"
import { currentTime, getAnalyser, isCurrent, player, usePlayer } from "./player-store.ts"

export interface SongWaveformProps {
  readonly track: PlayerTrack | null
  readonly variant?: WaveformVariant
  readonly className?: string
}

export default function SongWaveform({ track, variant = "hero", className }: SongWaveformProps) {
  const state = usePlayer()
  const current = isCurrent(state, track)
  const getTime = useCallback(() => (current ? currentTime() : 0), [current])
  const analyser = useCallback(() => (current ? getAnalyser() : null), [current])
  return (
    <Waveform
      variant={variant}
      peaks={track?.peaks}
      peaksRate={track?.peaksRate}
      duration={(current ? state.duration : 0) || track?.duration}
      getTime={getTime}
      playing={current && state.playing}
      getAnalyser={analyser}
      seed={track?.songId ?? track?.title ?? "riot"}
      onSeek={
        track
          ? (t) => {
              if (current) player.seek(t)
              else player.load(track, { startAt: t })
            }
          : undefined
      }
      className={className}
      aria-label={track ? `Waveform of ${track.title}` : "Waveform"}
    />
  )
}
