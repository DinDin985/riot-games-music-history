"use client"

import * as React from "react"
import { toast } from "sonner"
import { Loader2Icon, PlayIcon, ShuffleIcon } from "lucide-react"
import type { SongFilter, SongSummary } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePlayer } from "@/components/player/player-provider"
import { fetchSongs } from "@/lib/api-client"

const PAGE = 200
const MAX_SONGS = 1000

/** Every song matching `filter` through `/api/songs`, in pages of 200. */
async function fetchAll(filter: SongFilter, signal: AbortSignal): Promise<Array<SongSummary>> {
  const out: Array<SongSummary> = []
  for (;;) {
    const page = await fetchSongs({ ...filter, limit: PAGE, offset: out.length }, signal)
    out.push(...page.items)
    if (page.items.length === 0 || out.length >= page.total || out.length >= MAX_SONGS) return out
  }
}

function shuffled<A>(items: ReadonlyArray<A>): Array<A> {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * "Play all" / "Shuffle" for a whole collection (a game or a category) that
 * may be larger than what the page renders: the songs are fetched from the
 * JSON API on click, songs without audio are skipped, and the result replaces
 * the player queue.
 */
export function PlayCollectionButton({
  filter,
  shuffle = false,
  disabled = false,
  className,
  children,
}: {
  /** Which songs (game / category / artist) and in which order. */
  readonly filter: Pick<SongFilter, "game" | "category" | "artist" | "sort">
  readonly shuffle?: boolean
  readonly disabled?: boolean
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  const player = usePlayer()
  const [loading, setLoading] = React.useState(false)
  const abort = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => abort.current?.abort(), [])

  const onClick = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    try {
      const songs = (await fetchAll(filter, controller.signal)).filter((s) => s.audioUrl)
      const list = shuffle ? shuffled(songs) : songs
      if (list[0]) player.play(list[0], list)
      else toast("None of these songs is playable yet.")
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Could not load the songs.")
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setLoading(false)
      }
    }
  }

  return (
    <Button
      size="lg"
      variant={shuffle ? "outline" : "default"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("rounded-full px-5", className)}
      onClick={onClick}
    >
      {loading ? (
        <Loader2Icon className="animate-spin" />
      ) : shuffle ? (
        <ShuffleIcon />
      ) : (
        <PlayIcon className="fill-current" />
      )}
      {children ?? (shuffle ? "Shuffle" : "Play all")}
    </Button>
  )
}
