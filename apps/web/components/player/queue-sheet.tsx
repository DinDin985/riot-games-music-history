"use client"

import * as React from "react"
import { AudioLinesIcon, XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"

/** Slide-over listing the play queue. `children` is the trigger button. */
export function QueueSheet({ children }: { readonly children: React.ReactElement }) {
  const { queue, queueIndex, song, play, removeFromQueue, clearQueue, isPlaying } = usePlayer()
  const upNext = queue.length - Math.max(0, queueIndex) - 1

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Queue</SheetTitle>
          <SheetDescription>
            {queue.length === 0 ? "Nothing queued." : `${queue.length} songs · ${Math.max(0, upNext)} up next`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <ol className="flex flex-col gap-0.5 p-2">
            {queue.map((s, i) => {
              const current = s.id === song?.id
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/5",
                      current && "bg-white/[0.06]",
                      i < queueIndex && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => play(s, queue)}
                      disabled={!s.audioUrl}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Play ${s.title}`}
                    >
                      <SongArtwork
                        title={s.title}
                        coverUrl={s.coverUrl}
                        palette={s.palette}
                        seed={s.id}
                        animatedBackdrop={false}
                        className="size-10 shrink-0 rounded-md"
                      >
                        {current && (
                          <span className="absolute inset-0 grid place-items-center bg-black/45">
                            <AudioLinesIcon className={cn("size-4 text-gold", isPlaying && "animate-pulse")} />
                          </span>
                        )}
                      </SongArtwork>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-medium", current && "text-gold")}>{s.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{s.displayArtist}</span>
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(s.duration)}</span>
                    </button>
                    {!current && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeFromQueue(i)}
                        aria-label={`Remove ${s.title} from the queue`}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <XIcon />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </ScrollArea>
        {queue.length > 1 && (
          <SheetFooter className="border-t border-border">
            <Button variant="outline" onClick={clearQueue}>
              Clear queue
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
