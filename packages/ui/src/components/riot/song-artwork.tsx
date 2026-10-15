"use client"

import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"

/**
 * Song artwork with two layers, best first:
 *
 *  1. the album cover (`coverUrl`), lazy-loaded;
 *  2. an animated gradient in the album-cover colours (`palette`) — also what
 *     shows while the cover loads or when it fails.
 *
 * Always a still image: the music video's chorus GIF only plays on the /impact
 * stories (their own `FeaturedMedia`), never as a cover.
 *
 * Size it from the outside (`className="aspect-square w-full rounded-xl"`).
 * Extra `children` render on top (badges, play buttons…).
 */
export interface SongArtworkProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** Used for the image alt text. */
  readonly title: string
  readonly coverUrl?: string | null
  readonly palette?: ReadonlyArray<string>
  /** Stable id (e.g. song id) so palette backdrops differ between songs. */
  readonly seed?: string
  /** Animate the palette fallback (default true). */
  readonly animatedBackdrop?: boolean
  /**
   * How the cover sits:
   * - `"fill"` (default): edge to edge;
   * - `"inset"`: a centred sleeve on the animated palette backdrop — the
   *   "no music video" look.
   */
  readonly coverFit?: "fill" | "inset"
  /** Eagerly load the cover (above-the-fold hero). */
  readonly priority?: boolean
  readonly children?: React.ReactNode
}

export function SongArtwork({
  title,
  coverUrl,
  palette = [],
  seed,
  animatedBackdrop = true,
  coverFit = "fill",
  priority = false,
  className,
  children,
  ...props
}: SongArtworkProps) {
  const coverRef = React.useRef<HTMLImageElement>(null)
  const [coverState, setCoverState] = React.useState<"loading" | "ok" | "error">("loading")

  // Reset load state when the source changes (component reused for another song).
  React.useEffect(() => {
    // A server-rendered <img> can finish loading before hydration, in which case
    // React never sees its load event — check the element directly.
    const img = coverRef.current
    setCoverState(img && img.complete && img.naturalWidth > 0 ? "ok" : "loading")
  }, [coverUrl])

  const showCover = Boolean(coverUrl) && coverState !== "error"

  return (
    <div
      data-slot="song-artwork"
      className={cn("relative isolate overflow-hidden bg-navy-800", className)}
      {...props}
    >
      {/* Palette layer: visible until the cover has loaded (and as the fallback). */}
      {(!showCover || coverState !== "ok" || coverFit === "inset") && (
        <PaletteBackdrop palette={palette} seed={seed ?? title} animated={animatedBackdrop} className="absolute inset-0" />
      )}
      {showCover && (
        <img
          ref={coverRef}
          src={coverUrl!}
          alt={title}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setCoverState("ok")}
          onError={() => setCoverState("error")}
          className={cn(
            "absolute object-cover transition-opacity duration-500",
            coverFit === "inset"
              ? "inset-[19%] size-[62%] rounded-[6%] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)] ring-1 ring-white/15"
              : "inset-0 size-full",
            coverState === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {children}
    </div>
  )
}
