"use client"

import * as React from "react"
import type { ArtistRole, SongSummary } from "@workspace/db/domain/types"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { ROLE_FILTER_LABEL, ROLE_ORDER } from "../../_components/artist-meta"
import { ArtistSongRow } from "./artist-song-row"

export type CreditedSong = SongSummary & { readonly role: ArtistRole }

type Sort = "newest" | "oldest" | "popular"
type RoleFilter = "all" | ArtistRole

const SORTS: ReadonlyArray<{ readonly value: Sort; readonly label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "popular", label: "Popular" },
]

const views = (s: SongSummary) => s.viewCount ?? 0

function sortSongs(songs: ReadonlyArray<CreditedSong>, sort: Sort): Array<CreditedSong> {
  const out = [...songs]
  if (sort === "popular") return out.sort((a, b) => Number(b.isImpact) - Number(a.isImpact) || views(b) - views(a))
  const dir = sort === "newest" ? -1 : 1
  return out.sort((a, b) => {
    // Undated songs last in both directions.
    if (a.year === null || b.year === null) return a.year === null ? (b.year === null ? 0 : 1) : -1
    return (a.year - b.year) * dir || views(b) - views(a)
  })
}

const itemClass = "h-8 px-3 data-[state=on]:bg-gold/15 data-[state=on]:text-gold"

/**
 * An artist's songs with their credit role, filterable by role (when the
 * artist has more than one) and sortable by year (grouped under year
 * headers) or popularity. Play buttons queue the list as displayed.
 */
export function ArtistSongs({ songs }: { readonly songs: ReadonlyArray<CreditedSong> }) {
  const [sort, setSort] = React.useState<Sort>("newest")
  const [role, setRole] = React.useState<RoleFilter>("all")

  const roleCounts = ROLE_ORDER.map((r) => ({
    role: r,
    count: songs.filter((s) => s.role === r).length,
  })).filter((r) => r.count > 0)
  const filtered = role === "all" ? songs : songs.filter((s) => s.role === role)
  const list = sortSongs(filtered, sort)
  // Same song twice (two credits) → queue it once.
  const queue = list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i)
  const number = new Map(list.map((s, i) => [`${s.id}:${s.role}`, i + 1]))
  const byYear = sort !== "popular"

  // Year groups (list is already sorted by year).
  const groups: Array<{ year: number | null; songs: Array<CreditedSong> }> = []
  if (byYear) {
    for (const s of list) {
      const last = groups[groups.length - 1]
      if (last && last.year === s.year) last.songs.push(s)
      else groups.push({ year: s.year, songs: [s] })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {roleCounts.length > 1 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={role}
            onValueChange={(v) => v && setRole(v as RoleFilter)}
            aria-label="Filter by credit"
            className="flex-wrap"
          >
            <ToggleGroupItem value="all" className={itemClass}>
              All <span className="text-xs opacity-70">{formatNumber(songs.length)}</span>
            </ToggleGroupItem>
            {roleCounts.map((r) => (
              <ToggleGroupItem key={r.role} value={r.role} className={itemClass}>
                {ROLE_FILTER_LABEL[r.role]} <span className="text-xs opacity-70">{formatNumber(r.count)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <p className="text-sm text-muted-foreground">{pluralize(songs.length, "song")}</p>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={sort}
          onValueChange={(v) => v && setSort(v as Sort)}
          aria-label="Sort songs"
        >
          {SORTS.map((s) => (
            <ToggleGroupItem key={s.value} value={s.value} className={itemClass}>
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {byYear ? (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.year ?? "undated"} aria-label={g.year ? String(g.year) : "Undated"}>
              <h3 className="sticky top-16 z-10 mb-1 flex items-baseline gap-3 border-b border-white/[0.06] bg-background/85 py-1.5 backdrop-blur">
                <span className="font-display text-3xl leading-none tracking-wide">{g.year ?? "Undated"}</span>
                <span className="text-xs text-muted-foreground">{pluralize(g.songs.length, "song")}</span>
              </h3>
              <div role="list" className="flex flex-col">
                {g.songs.map((s) => (
                  <div role="listitem" key={`${s.id}:${s.role}`}>
                    <ArtistSongRow song={s} role={s.role} queue={queue} index={number.get(`${s.id}:${s.role}`) ?? 0} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div role="list" className="flex flex-col">
          {list.map((s) => (
            <div role="listitem" key={`${s.id}:${s.role}`}>
              <ArtistSongRow song={s} role={s.role} queue={queue} index={number.get(`${s.id}:${s.role}`) ?? 0} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
