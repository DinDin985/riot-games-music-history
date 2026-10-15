"use client"

import * as React from "react"
import { CheckIcon, ExternalLinkIcon, LinkIcon, ListPlusIcon, Loader2Icon, PauseIcon, PlayIcon, TvMinimalPlayIcon } from "lucide-react"
import { toast } from "sonner"
import type { SongSummary } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"

/**
 * Hero buttons of a song page: Play/Pause, "Watch music video", add to queue,
 * copy a link to the current moment, and the music video on YouTube.
 *
 * "Watch music video" opens the popup synced to where the song is. When this
 * song is not the one loaded, it starts the song first (inside the click, so
 * the browser allows playback) and opens the popup once it is current — the
 * popup then pauses the audio and closing it resumes the song where the video
 * left off. Disabled, with a tooltip saying why, when no MV is downloaded.
 */
export function SongHeroActions({
  song,
  queue,
  youtubeMvUrl,
}: {
  readonly song: SongSummary
  readonly queue: ReadonlyArray<SongSummary>
  /** The music video on YouTube, when there is one (downloaded or not). */
  readonly youtubeMvUrl: string | null
}) {
  const player = usePlayer()
  const isCurrent = player.song?.id === song.id
  const playing = isCurrent && player.isPlaying
  const loading = playing && player.isLoading
  const playable = Boolean(song.audioUrl)
  const pendingWatch = React.useRef(false)
  const [copied, setCopied] = React.useState(false)

  // Second half of "Watch music video" for a song that was not loaded yet.
  React.useEffect(() => {
    if (pendingWatch.current && player.song?.id === song.id) {
      pendingWatch.current = false
      player.openVideo()
    }
  }, [player, song.id])

  const watch = () => {
    if (!song.hasVideo) return
    if (isCurrent) {
      player.openVideo()
    } else if (playable) {
      pendingWatch.current = true
      player.play(song, queue)
    } else {
      player.openVideo({ song, songTime: 0 })
    }
  }

  const copyLink = async () => {
    const url = new URL(`/songs/${encodeURIComponent(song.id)}`, window.location.origin)
    const t = isCurrent ? Math.floor(player.getCurrentTime()) : 0
    if (t > 0) url.searchParams.set("t", String(t))
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast(t > 0 ? `Link to ${formatDuration(t)} copied` : "Link copied", { id: `copy-${song.id}` })
    } catch {
      toast.error("Couldn’t copy the link", { description: url.toString() })
    }
  }

  const videoTooltip = song.hasVideo
    ? isCurrent
      ? "Open the music video at this exact moment of the song"
      : "Start the song and open its music video"
    : youtubeMvUrl
      ? "The music video has not been downloaded yet — watch it on YouTube"
      : "This song has no music video"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="lg"
        disabled={!playable}
        aria-pressed={playing}
        onClick={() => (isCurrent ? player.toggle() : player.play(song, queue))}
        className="h-12 min-w-36 rounded-full bg-white px-7 text-base font-semibold text-[#0c1d2e] shadow-[0_12px_32px_-12px_rgb(255_255_255/0.45)] hover:bg-gold"
      >
        {loading ? (
          <Loader2Icon className="size-5 animate-spin" />
        ) : playing ? (
          <PauseIcon className="size-5 fill-current" />
        ) : (
          <PlayIcon className="size-5 fill-current" />
        )}
        {!playable ? "Not playable yet" : playing ? "Pause" : isCurrent ? "Resume" : "Play"}
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          {/* The wrapper keeps the tooltip reachable when the button is disabled. */}
          <span tabIndex={song.hasVideo ? -1 : 0} className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <Button
              size="lg"
              variant="outline"
              disabled={!song.hasVideo}
              onClick={watch}
              className={cn(
                "h-12 rounded-full border-white/20 bg-black/25 px-5 text-base backdrop-blur",
                song.hasVideo && "hover:border-gold/70 hover:text-gold",
              )}
            >
              <TvMinimalPlayIcon className="size-5" />
              Watch music video
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{videoTooltip}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-lg"
            variant="ghost"
            disabled={!playable}
            onClick={() => player.enqueue(song, { next: true })}
            aria-label="Play next"
            className="size-12 rounded-full bg-black/20 backdrop-blur hover:bg-white/10"
          >
            <ListPlusIcon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Play next</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-lg"
            variant="ghost"
            onClick={copyLink}
            aria-label={isCurrent ? "Copy a link to this moment" : "Copy link"}
            className="size-12 rounded-full bg-black/20 backdrop-blur hover:bg-white/10"
          >
            {copied ? <CheckIcon className="size-5 text-gold" /> : <LinkIcon className="size-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{isCurrent ? "Copy a link to this moment" : "Copy link"}</TooltipContent>
      </Tooltip>

      {youtubeMvUrl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="icon-lg"
              variant="ghost"
              className="size-12 rounded-full bg-black/20 backdrop-blur hover:bg-white/10"
            >
              <a href={youtubeMvUrl} target="_blank" rel="noreferrer" aria-label="Music video on YouTube">
                <ExternalLinkIcon className="size-5" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Music video on YouTube</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
