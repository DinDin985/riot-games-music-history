"use client"

import * as React from "react"
import { Loader2Icon, PauseIcon, PlayIcon, ShuffleIcon } from "lucide-react"
import type { SongSummary } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"

/**
 * Round play/pause button for one song. Plays `song` with `queue` (so "next"
 * continues through the list it was clicked in); toggles when it is already
 * the current song. Disabled when the song has no audio.
 */
export function SongPlayButton({
  song,
  queue,
  size = "md",
  variant = "solid",
  className,
}: {
  readonly song: SongSummary
  readonly queue?: ReadonlyArray<SongSummary>
  readonly size?: "sm" | "md" | "lg"
  /** `solid`: white disc (on artwork); `ghost`: transparent (in rows). */
  readonly variant?: "solid" | "ghost"
  readonly className?: string
}) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id
  const playing = isCurrent && player.isPlaying
  const loading = playing && player.isLoading
  const disabled = !song.audioUrl
  const dims = size === "sm" ? "size-8" : size === "lg" ? "size-14" : "size-11"
  const icon = size === "sm" ? "size-3.5" : size === "lg" ? "size-6" : "size-[18px]"

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={disabled ? `${song.title} is not playable yet` : playing ? `Pause ${song.title}` : `Play ${song.title}`}
      aria-pressed={playing}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (isCurrent) player.toggle()
        else player.play(song, queue)
      }}
      className={cn(
        "relative z-10 grid shrink-0 place-items-center rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
        dims,
        variant === "solid"
          ? "bg-white text-[#0c1d2e] shadow-[0_8px_24px_-6px_rgb(0_0_0/0.6)] hover:scale-105 hover:bg-gold active:scale-95"
          : "text-foreground hover:bg-white/10",
        className,
      )}
    >
      {loading ? (
        <Loader2Icon className={cn(icon, "animate-spin")} />
      ) : playing ? (
        <PauseIcon className={cn(icon, "fill-current")} />
      ) : (
        <PlayIcon className={cn(icon, "translate-x-[1px] fill-current")} />
      )}
    </button>
  )
}

/** Fisher–Yates shuffle (copy). */
function shuffled<A>(items: ReadonlyArray<A>): Array<A> {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** "Play all" / "Shuffle" for a list of songs (skips songs without audio). */
export function PlayAllButton({
  songs,
  shuffle = false,
  className,
  children,
}: {
  readonly songs: ReadonlyArray<SongSummary>
  readonly shuffle?: boolean
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  const player = usePlayer()
  const playable = songs.filter((s) => s.audioUrl)
  return (
    <Button
      size="lg"
      variant={shuffle ? "outline" : "default"}
      disabled={playable.length === 0}
      className={cn("rounded-full px-5", className)}
      onClick={() => {
        const list = shuffle ? shuffled(playable) : playable
        if (list[0]) player.play(list[0], list)
      }}
    >
      {shuffle ? <ShuffleIcon /> : <PlayIcon className="fill-current" />}
      {children ?? (shuffle ? "Shuffle" : "Play all")}
    </Button>
  )
}
