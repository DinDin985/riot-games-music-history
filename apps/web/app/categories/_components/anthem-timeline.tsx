import type { SongSummary } from "@workspace/db/domain/types"
import { pluralize } from "@workspace/ui/components/riot/format"
import { SongRow } from "@/components/songs/song-row"
import { FeatureSongCard } from "./feature-song-card"

interface YearGroup {
  readonly year: number | null
  readonly anthem: SongSummary
  readonly others: ReadonlyArray<SongSummary>
}

/**
 * Group songs (already in chronological order, either direction) by year.
 * Each year's anthem is its most-viewed song that is not a remix; the rest
 * keep their order.
 */
function groupByYear(songs: ReadonlyArray<SongSummary>): Array<YearGroup> {
  const groups = new Map<number | null, Array<SongSummary>>()
  for (const s of songs) {
    const list = groups.get(s.year) ?? []
    list.push(s)
    groups.set(s.year, list)
  }
  const out: Array<YearGroup> = []
  for (const [year, list] of groups) {
    const candidates = list.filter((s) => !s.categoryIds.includes("remix") && !/\bremix\b/i.test(s.title))
    const pool = candidates.length > 0 ? candidates : list
    const anthem = pool.reduce((best, s) => ((s.viewCount ?? 0) > (best.viewCount ?? 0) ? s : best), pool[0]!)
    out.push({ year, anthem, others: list.filter((s) => s !== anthem) })
  }
  // Undated songs last, whatever the direction.
  return [...out.filter((g) => g.year !== null), ...out.filter((g) => g.year === null)]
}

/**
 * The anthem timeline used by Worlds (and the other yearly-event categories):
 * a year rail with sticky year headers, the year's anthem as a wide feature
 * card and that year's other songs (themes, finals music, remixes) as rows.
 * Every play button queues the whole timeline in display order.
 */
export function AnthemTimeline({
  songs,
  anthemLabel,
}: {
  /** Chronological (oldest → newest or newest → oldest). */
  readonly songs: ReadonlyArray<SongSummary>
  /** Caption for each year's headline song, e.g. "Worlds 2017 anthem". */
  readonly anthemLabel: (year: number | null) => string
}) {
  const groups = groupByYear(songs)
  const queue = groups.flatMap((g) => [g.anthem, ...g.others])
  return (
    <div className="flex flex-col gap-8">
      <nav
        aria-label="Jump to year"
        className="-mx-4 flex scrollbar-none gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0"
      >
        {groups.map((g) => (
          <a
            key={g.year ?? "undated"}
            href={`#year-${g.year ?? "undated"}`}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-white/10 px-3 font-display text-lg tracking-wide text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold"
          >
            {g.year ?? "Undated"}
          </a>
        ))}
      </nav>

      <ol className="flex flex-col">
        {groups.map((g, i) => (
          <li
            key={g.year ?? "undated"}
            id={`year-${g.year ?? "undated"}`}
            className="grid scroll-mt-24 gap-3 md:grid-cols-[9rem_1fr] md:gap-8"
          >
            <div className="self-start md:sticky md:top-24 md:pt-3">
              <h3 className="font-display text-6xl leading-none tracking-wide text-white md:text-7xl">
                {g.year ?? "—"}
              </h3>
              <p className="mt-1 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                {pluralize(g.others.length + 1, "song")}
              </p>
            </div>
            <div className="relative border-l border-white/10 pb-10 pl-5 md:pl-8">
              <span
                aria-hidden
                className="absolute top-6 -left-[6px] size-[11px] rounded-full bg-gold shadow-[0_0_0_4px_color-mix(in_oklab,var(--gold)_25%,transparent)]"
              />
              {i === groups.length - 1 && (
                <span
                  aria-hidden
                  className="absolute bottom-0 -left-px h-10 w-px bg-gradient-to-b from-white/10 to-[#0c1d2e]"
                />
              )}
              <FeatureSongCard song={g.anthem} queue={queue} label={anthemLabel(g.year)} />
              {g.others.length > 0 && (
                <div role="list" className="mt-2 flex flex-col">
                  {g.others.map((s) => (
                    <div role="listitem" key={s.id}>
                      <SongRow song={s} queue={queue} showYear={false} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
