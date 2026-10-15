import type { SongSummary } from "@workspace/db/domain/types"
import { cn } from "@workspace/ui/lib/utils"
import { SongCard, type SongCardProps } from "@/components/songs/song-card"

/**
 * Responsive grid of SongCards sharing one play queue (the songs themselves,
 * unless `queue` is given). Works from Server Components (props are plain data).
 *
 * Props:
 * - `songs` (required)
 * - `queue` — override the queue used by every card's play button
 * - `columns` — "default" (2→6 columns) | "wide" (2→5, bigger cards) | "strip" (one horizontal scrolling row)
 * - `ranked` — show #1, #2… on the artwork
 * - `priorityCount` — eager-load the first N covers (default 6)
 * - `cardProps` — forwarded to every SongCard (showGame, showCategory, showViews…)
 * - `empty` — rendered when `songs` is empty
 */
export function SongGrid({
  songs,
  queue,
  columns = "default",
  ranked = false,
  priorityCount = 6,
  cardProps,
  empty,
  className,
}: {
  readonly songs: ReadonlyArray<SongSummary>
  readonly queue?: ReadonlyArray<SongSummary>
  readonly columns?: "default" | "wide" | "strip"
  readonly ranked?: boolean
  readonly priorityCount?: number
  readonly cardProps?: Omit<SongCardProps, "song" | "queue" | "rank" | "priority">
  readonly empty?: React.ReactNode
  readonly className?: string
}) {
  if (songs.length === 0) return <>{empty ?? null}</>
  const list = queue ?? songs
  return (
    <div
      className={cn(
        columns === "strip"
          ? "scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 [&>*]:w-[46%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-[31%] md:[&>*]:w-[23%] lg:[&>*]:w-[18.5%] 2xl:[&>*]:w-[15.5%]"
          : columns === "wide"
            ? "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
            : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        className,
      )}
    >
      {songs.map((song, i) => (
        <SongCard
          key={song.id}
          song={song}
          queue={list}
          rank={ranked ? i + 1 : undefined}
          priority={i < priorityCount}
          {...cardProps}
        />
      ))}
    </div>
  )
}
