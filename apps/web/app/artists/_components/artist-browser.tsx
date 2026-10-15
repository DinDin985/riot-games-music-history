"use client"

import * as React from "react"
import { SearchIcon, UsersIcon, XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { formatNumber } from "@workspace/ui/components/riot/format"
import { ArtistCard, type ArtistCardData } from "./artist-card"
import { KIND_TABS, isKindTab, searchKey, type ArtistSortKey, type KindTab } from "./artist-meta"

const PAGE = 60

/**
 * Client-side browser over every collaborator: search by name, kind tabs with
 * counts, sort (most songs / A–Z) and an incrementally rendered grid ("show
 * more" + auto-load near the bottom). The state is mirrored into the URL
 * (`?q=&kind=&sort=`) with `history.replaceState`, so a filtered view can be
 * shared or reloaded.
 */
export function ArtistBrowser({
  artists,
  initialQuery = "",
  initialKind = "all",
  initialSort = "songs",
}: {
  readonly artists: ReadonlyArray<ArtistCardData>
  readonly initialQuery?: string
  readonly initialKind?: KindTab
  readonly initialSort?: ArtistSortKey
}) {
  const [query, setQuery] = React.useState(initialQuery)
  const [kind, setKind] = React.useState<KindTab>(initialKind)
  const [sort, setSort] = React.useState<ArtistSortKey>(initialSort)
  const [visible, setVisible] = React.useState(PAGE)
  const deferredQuery = React.useDeferredValue(query)

  // Search keys computed once.
  const indexed = React.useMemo(() => artists.map((a) => ({ artist: a, key: searchKey(a.name) })), [artists])

  const matchingQuery = React.useMemo(() => {
    const q = searchKey(deferredQuery.trim())
    return q ? indexed.filter((x) => x.key.includes(q)) : indexed
  }, [indexed, deferredQuery])

  const counts = React.useMemo(() => {
    const out = new Map<KindTab, number>()
    for (const tab of KIND_TABS)
      out.set(
        tab.value,
        tab.kinds ? matchingQuery.filter((x) => tab.kinds!.includes(x.artist.kind)).length : matchingQuery.length,
      )
    return out
  }, [matchingQuery])

  const results = React.useMemo(() => {
    const tab = KIND_TABS.find((t) => t.value === kind)
    const list = tab?.kinds ? matchingQuery.filter((x) => tab.kinds!.includes(x.artist.kind)) : matchingQuery
    const sorted = [...list]
    if (sort === "name")
      sorted.sort((a, b) =>
        a.artist.name.localeCompare(b.artist.name, "en", {
          sensitivity: "base",
        }),
      )
    else
      sorted.sort(
        (a, b) =>
          b.artist.songCount - a.artist.songCount ||
          a.artist.name.localeCompare(b.artist.name, "en", {
            sensitivity: "base",
          }),
      )
    return sorted.map((x) => x.artist)
  }, [matchingQuery, kind, sort])

  // New filter → start from the first page again.
  const filterKey = `${deferredQuery}|${kind}|${sort}`
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setVisible(PAGE)
  }

  // Mirror the state into the URL (no navigation, no history entries).
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      const set = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key))
      set("q", deferredQuery.trim() || null)
      set("kind", kind === "all" ? null : kind)
      set("sort", sort === "songs" ? null : sort)
      const qs = params.toString()
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`
      if (url !== `${window.location.pathname}${window.location.search}`)
        window.history.replaceState(window.history.state, "", url)
    }, 250)
    return () => window.clearTimeout(id)
  }, [deferredQuery, kind, sort])

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinel = React.useRef<HTMLDivElement>(null)
  const hasMore = visible < results.length
  React.useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + PAGE)
      },
      { rootMargin: "600px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, visible])

  const shown = results.slice(0, visible)

  return (
    <Tabs value={kind} onValueChange={(v) => isKindTab(v) && setKind(v)} className="gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 scrollbar-none overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <TabsList className="h-10! bg-white/[0.04] p-1">
            {KIND_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2 px-3 data-active:text-gold">
                {tab.label}
                <span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] text-muted-foreground tabular-nums">
                  {formatNumber(counts.get(tab.value) ?? 0)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="h-10 rounded-full bg-white/[0.03] sm:w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artists, bands, composers…"
              aria-label="Search artists"
              autoComplete="off"
              spellCheck={false}
              className="[&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="rounded-full"
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={sort}
            onValueChange={(v) => (v === "songs" || v === "name") && setSort(v)}
            aria-label="Sort artists"
            className="shrink-0"
          >
            <ToggleGroupItem value="songs" className="h-10 px-3.5 data-[state=on]:bg-gold/15 data-[state=on]:text-gold">
              Most songs
            </ToggleGroupItem>
            <ToggleGroupItem value="name" className="h-10 px-3.5 data-[state=on]:bg-gold/15 data-[state=on]:text-gold">
              A–Z
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {KIND_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results.length === 0
              ? "No matches"
              : `Showing ${formatNumber(shown.length)} of ${formatNumber(results.length)} ${results.length === 1 ? "collaborator" : "collaborators"}`}
            {deferredQuery.trim() ? ` for “${deferredQuery.trim()}”` : ""}
          </p>
          {results.length === 0 ? (
            <Empty className="border border-dashed border-white/10 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>No collaborator found</EmptyTitle>
                <EmptyDescription>
                  {deferredQuery.trim()
                    ? `Nobody in this list matches “${deferredQuery.trim()}”. Try another spelling or the All tab.`
                    : "There is nobody of this kind in the archive yet."}
                </EmptyDescription>
              </EmptyHeader>
              {(query || kind !== "all") && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setQuery("")
                    setKind("all")
                  }}
                >
                  Clear filters
                </Button>
              )}
            </Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
              {shown.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          )}
          {hasMore && (
            <div ref={sentinel} className="flex justify-center pt-4">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full px-6"
                onClick={() => setVisible((v) => v + PAGE)}
              >
                Show more · {formatNumber(results.length - visible)} left
              </Button>
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
