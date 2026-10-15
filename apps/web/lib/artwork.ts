import type { SongSummary } from "@workspace/db/domain/types"

/**
 * Identity of a song's picture, or null without a cover. Tracks from one album
 * share one picture under different files (≈380 pictures for ≈1,100 songs):
 * the pipeline's `coverKey` groups them, including re-encoded copies. Without
 * one, an equal palette (derived from the image) stands for the same picture.
 */
export function artworkKey(song: SongSummary): string | null {
  if (!song.coverUrl) return null
  return song.coverKey ?? (song.palette.length > 0 ? song.palette.join(",") : song.coverUrl)
}

/**
 * Covers for a grid of collection cards, in display order: up to `count` songs
 * per card (each list in popularity order), never the same picture twice in a
 * card and never a picture an earlier card already shows. A card that runs out
 * of unseen pictures may reuse one, but only from a card more than `columns + 1`
 * places away, so with up to `columns` columns no two cards side by side,
 * above/below or diagonal ever share a cover. Songs without artwork top up a
 * short card, as in `collectionStats`.
 */
export function distinctCovers(
  collections: ReadonlyArray<ReadonlyArray<SongSummary>>,
  count: number,
  columns: number,
): Array<Array<SongSummary>> {
  const seen = new Set<string>()
  const picked: Array<Array<SongSummary>> = []
  collections.forEach((songs, i) => {
    const near = new Set(
      picked
        .slice(Math.max(0, i - columns - 1))
        .flat()
        .map(artworkKey),
    )
    const own = new Set<string>()
    const out: Array<SongSummary> = []
    const take = (allowed: (key: string) => boolean) => {
      for (const s of songs) {
        if (out.length >= count) return
        const key = artworkKey(s)
        if (key === null || own.has(key) || !allowed(key)) continue
        own.add(key)
        out.push(s)
      }
    }
    take((key) => !seen.has(key))
    take((key) => !near.has(key))
    for (const s of songs) if (out.length < count && !s.coverUrl) out.push(s)
    for (const key of own) seen.add(key)
    picked.push(out)
  })
  return picked
}
