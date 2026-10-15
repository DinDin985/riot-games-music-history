/** Play/pause button for one song (story cards, story hero). Drives the shared page player. */
import { LoaderCircle, Pause, Play } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { PlayerTrack } from "../../lib/types.ts"
import { isCurrent, player, usePlayer } from "./player-store.ts"

export interface PlayButtonProps {
  readonly track: PlayerTrack | null
  /** Text after the icon; omitted for an icon-only button. */
  readonly label?: string
  readonly size?: "default" | "lg" | "icon" | "icon-lg"
  readonly variant?: "default" | "secondary" | "outline" | "ghost"
  readonly className?: string
}

export default function PlayButton({ track, label, size = "lg", variant = "default", className }: PlayButtonProps) {
  const state = usePlayer()
  const current = isCurrent(state, track)
  const playing = current && state.playing
  const loading = current && state.loading && !state.playing
  const title = !track
    ? "Audio for this song is not in the archive yet"
    : playing
      ? `Pause ${track.title}`
      : `Play ${track.title}`

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={!track}
      aria-label={title}
      aria-pressed={playing}
      title={title}
      onClick={() => player.toggle(track)}
      className={cn(variant === "default" && "bg-white text-[#0c1d2e] hover:bg-white/85", className)}
    >
      {loading ? (
        <LoaderCircle className="animate-spin" data-icon="inline-start" />
      ) : playing ? (
        <Pause className="fill-current" data-icon="inline-start" />
      ) : (
        <Play className="fill-current" data-icon="inline-start" />
      )}
      {label ? <span>{playing ? "Pause" : label}</span> : null}
    </Button>
  )
}
