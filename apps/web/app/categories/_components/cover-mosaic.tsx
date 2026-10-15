import type { SongSummary } from "@workspace/db/domain/types"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Collage of a collection's most popular songs: one big tile and two small
 * ones. Each tile is a `SongArtwork` showing the song's still album cover.
 * Size it from the outside
 * (`className="aspect-[3/2]"`). Server- and client-safe (no hooks).
 */
export function CoverMosaic({
  songs,
  seed,
  fallbackPalette = [],
  className,
  children,
}: {
  readonly songs: ReadonlyArray<SongSummary>
  /** Seed for the palette fallback when there are no songs. */
  readonly seed: string
  /** Colours of the animated backdrop shown when there are no songs (e.g. the game colour). */
  readonly fallbackPalette?: ReadonlyArray<string>
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  const tiles = songs.slice(0, 3)
  if (tiles.length === 0) {
    return (
      <PaletteBackdrop palette={fallbackPalette} seed={seed} className={cn("relative", className)}>
        {children}
      </PaletteBackdrop>
    )
  }
  return (
    <div
      className={cn(
        "relative grid gap-0.5 overflow-hidden bg-navy-950",
        tiles.length === 1 ? "grid-cols-1" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-3 grid-rows-2",
        className,
      )}
    >
      {tiles.map((song, i) => (
        <SongArtwork
          key={song.id}
          title={song.title}
          coverUrl={song.coverUrl}
          palette={song.palette}
          seed={song.id}
          animatedBackdrop={i === 0}
          className={cn("size-full min-h-0", tiles.length === 3 && i === 0 && "col-span-2 row-span-2")}
        />
      ))}
      {children}
    </div>
  )
}

/**
 * Fanned stack of up to four covers for detail heroes, the most popular in
 * front.
 */
export function CoverStack({
  songs,
  className,
}: {
  readonly songs: ReadonlyArray<SongSummary>
  readonly className?: string
}) {
  const stack = songs.slice(0, 4)
  if (stack.length === 0) return null
  // Back to front: the most popular song ends up on top.
  const placements = [
    "translate-x-[34%] -translate-y-[6%] rotate-[10deg] scale-[0.82] opacity-70",
    "translate-x-[20%] -translate-y-[2%] rotate-[5deg] scale-[0.88] opacity-85",
    "translate-x-[8%] rotate-[1.5deg] scale-[0.94]",
    "-rotate-[3deg]",
  ].slice(4 - stack.length)
  return (
    <div aria-hidden className={cn("relative size-56 shrink-0 xl:size-64", className)}>
      {[...stack].reverse().map((song, i) => (
        <SongArtwork
          key={song.id}
          title={song.title}
          coverUrl={song.coverUrl}
          palette={song.palette}
          seed={song.id}
          animatedBackdrop={i === stack.length - 1}
          priority
          className={cn(
            "absolute inset-0 rounded-2xl shadow-[0_30px_60px_-20px_rgb(0_0_0/0.85)] ring-1 ring-white/15 transition-transform duration-500",
            placements[i],
          )}
        />
      ))}
    </div>
  )
}
