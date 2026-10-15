/**
 * "Watch from m:ss" action for a story's featured clip.
 *  - moment inside the song's music video -> link to the Next.js song page
 *    (`/songs/<id>?vt=<s>&watch=1`), which pops the MV up in sync with the song;
 *  - otherwise, when the video is downloaded -> play it here in a dialog from `start`;
 *  - otherwise -> YouTube at `start`.
 */
import { useRef } from "react"
import { Clapperboard, ExternalLink } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { formatClock } from "../lib/format.ts"
import { player } from "./player/player-store.ts"

export interface WatchMomentProps {
  readonly href: string
  readonly external: boolean
  readonly localVideoUrl: string | null
  readonly start: number
  readonly title: string
  readonly description?: string | null
  readonly size?: "default" | "lg"
  readonly variant?: "default" | "secondary" | "outline"
}

export default function WatchMoment({
  href,
  external,
  localVideoUrl,
  start,
  title,
  description,
  size = "lg",
  variant = "secondary",
}: WatchMomentProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const label = `Watch from ${formatClock(start)}`

  if (!external || !localVideoUrl) {
    return (
      <Button asChild size={size} variant={variant}>
        <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
          <Clapperboard data-icon="inline-start" />
          {label}
          {external ? <ExternalLink className="opacity-60" data-icon="inline-end" /> : null}
        </a>
      </Button>
    )
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        // Pause the mini player while the video plays, and the video when the dialog closes.
        if (open && player.getSnapshot().playing) player.toggle()
        if (!open) videoRef.current?.pause()
      }}
    >
      <DialogTrigger asChild>
        <Button size={size} variant={variant}>
          <Clapperboard data-icon="inline-start" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-3 border-white/10 bg-[#0c1d2e] p-3 text-white sm:max-w-4xl sm:p-4">
        <DialogHeader className="px-1 text-left">
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription className="text-white/60">
            {description ? `${description} · ` : ""}from {formatClock(start)}
          </DialogDescription>
        </DialogHeader>
        <video
          ref={videoRef}
          src={`${localVideoUrl}#t=${start}`}
          controls
          autoPlay
          playsInline
          className="aspect-video w-full rounded-lg bg-black"
          onLoadedMetadata={(e) => {
            if (Math.abs(e.currentTarget.currentTime - start) > 1) e.currentTarget.currentTime = start
          }}
        />
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-end px-1 text-xs text-white/60 hover:text-white"
        >
          Open on YouTube <ExternalLink className="size-3" />
        </a>
      </DialogContent>
    </Dialog>
  )
}
