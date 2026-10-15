"use client"

import * as React from "react"
import {
  ArrowDownWideNarrowIcon,
  LayoutGridIcon,
  ListIcon,
  Loader2Icon,
  SearchIcon,
  TvMinimalPlayIcon,
  XIcon,
} from "lucide-react"
import type { SongSort } from "@workspace/db/domain/types"
import { Button } from "@workspace/ui/components/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"
import { SONG_SORTS } from "@/lib/song-filter"
import {
  SORT_LABELS,
  activeFilterCount,
  libraryHref,
  type LibraryState,
  type LibraryView,
} from "./library-params"
import { useLibraryTransition } from "./library-transition"

/**
 * The library's sticky filter bar. Every control rewrites the URL (`/songs?…`)
 * through one shared transition, so filters are shareable, the back button
 * works and the Server Component re-queries SQLite. The search box is
 * debounced (300 ms; Enter applies immediately, Escape clears).
 */
export interface FacetOption {
  readonly id: string
  readonly name: string
  readonly count: number
}

const ALL = "__all__"
const SEARCH_DEBOUNCE_MS = 300

export function LibraryFilters({
  state,
  games,
  categories,
  years,
  artistName,
}: {
  readonly state: LibraryState
  readonly games: ReadonlyArray<FacetOption>
  readonly categories: ReadonlyArray<FacetOption>
  readonly years: ReadonlyArray<{ readonly year: number; readonly count: number }>
  /** Display name of `state.artist` (the artist filter has no select; it arrives from artist pages). */
  readonly artistName: string | null
}) {
  const { isPending, navigate } = useLibraryTransition()
  const latest = React.useRef(state)
  latest.current = state

  // ---- Debounced search ---------------------------------------------------
  const [query, setQuery] = React.useState(state.q)
  const lastPushed = React.useRef(state.q)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // The URL changed from elsewhere (chip removed, "clear all", back button): mirror it.
  React.useEffect(() => {
    if (state.q !== lastPushed.current) {
      lastPushed.current = state.q
      setQuery(state.q)
    }
  }, [state.q])

  const pushQuery = React.useCallback(
    (value: string) => {
      const q = value.trim().slice(0, 100)
      if (q === lastPushed.current) return
      lastPushed.current = q
      navigate(libraryHref(latest.current, { q }))
    },
    [navigate],
  )

  React.useEffect(() => {
    if (query.trim() === lastPushed.current) return
    const timer = setTimeout(() => pushQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, pushQuery])

  const set = (patch: Partial<LibraryState>) => navigate(libraryHref(latest.current, patch))

  const filterCount = activeFilterCount(state)
  const yearOptions = years.some((y) => y.year === state.year) || state.year === null
    ? years
    : [{ year: state.year, count: 0 }, ...years]

  return (
    <div className="z-30 border-b border-white/[0.06] bg-background/80 md:sticky md:top-16 backdrop-blur-xl supports-backdrop-filter:bg-background/65">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2.5 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <InputGroup className="h-10 rounded-full bg-white/[0.03] lg:max-w-sm xl:max-w-md">
            <InputGroupAddon align="inline-start" className="pl-3.5">
              {isPending && query.trim() !== state.q ? (
                <Loader2Icon className="animate-spin text-gold" aria-hidden />
              ) : (
                <SearchIcon aria-hidden />
              )}
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search songs, artists, albums"
              placeholder="Search songs, artists, albums…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  pushQuery(query)
                } else if (e.key === "Escape" && query) {
                  e.preventDefault()
                  setQuery("")
                  pushQuery("")
                }
              }}
              className="[&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <InputGroupAddon align="inline-end" className="pr-2.5">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  className="rounded-full"
                  onClick={() => {
                    setQuery("")
                    pushQuery("")
                    inputRef.current?.focus()
                  }}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 md:-mx-6 md:px-6 lg:mx-0 lg:flex-1 lg:overflow-visible lg:px-0 lg:pb-0">
            <FacetSelect
              label="Game"
              allLabel="All games"
              value={state.game}
              options={games}
              format={(id) => gameInfo(id).name}
              onChange={(game) => set({ game })}
              renderDot={(id) => gameInfo(id).color}
            />
            <FacetSelect
              label="Category"
              allLabel="All categories"
              value={state.category}
              options={categories}
              format={(id) => categoryInfo(id).name}
              onChange={(category) => set({ category })}
            />
            <Select
              value={state.year === null ? ALL : String(state.year)}
              onValueChange={(v) => set({ year: v === ALL ? null : Number(v) })}
            >
              <SelectTrigger
                aria-label="Year"
                className={cn(triggerClass, state.year !== null && activeTriggerClass)}
              >
                <SelectValue placeholder="Year">{state.year === null ? "All years" : state.year}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-80">
                <SelectItem value={ALL}>All years</SelectItem>
                <SelectSeparator />
                {yearOptions.map((y) => (
                  <SelectItem key={y.year} value={String(y.year)} className={countedItemClass}>
                    <span className="tabular-nums">{y.year}</span>
                    {y.count > 0 && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{y.count}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] pr-3 pl-2.5 transition-colors",
                state.video && "border-gold/50 bg-gold/10",
              )}
            >
              <Switch
                id="library-has-video"
                checked={state.video}
                onCheckedChange={(video) => set({ video })}
                className="data-checked:bg-gold"
              />
              <Label htmlFor="library-has-video" className="cursor-pointer gap-1.5 text-sm font-medium whitespace-nowrap">
                <TvMinimalPlayIcon className={cn("size-4", state.video ? "text-gold" : "text-muted-foreground")} aria-hidden />
                Has music video
              </Label>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
              <Select value={state.sort} onValueChange={(v) => set({ sort: v as SongSort })}>
                <SelectTrigger aria-label="Sort by" className={cn(triggerClass, "min-w-40")}>
                  <ArrowDownWideNarrowIcon className="text-muted-foreground" aria-hidden />
                  <SelectValue>{SORT_LABELS[state.sort]}</SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  {SONG_SORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={state.view}
                onValueChange={(v) => {
                  if (v === "grid" || v === "list") navigate(libraryHref(latest.current, { view: v as LibraryView }))
                }}
                aria-label="Layout"
                className="h-9 rounded-full"
              >
                <ToggleGroupItem value="grid" aria-label="Grid view" className="h-9 rounded-l-full! pl-3 data-[state=on]:bg-white/10 data-[state=on]:text-gold">
                  <LayoutGridIcon />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view" className="h-9 rounded-r-full! pr-3 data-[state=on]:bg-white/10 data-[state=on]:text-gold">
                  <ListIcon />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>

        {filterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {state.q && <FilterChip label={`“${state.q}”`} kind="Search" onRemove={() => set({ q: "" })} />}
            {state.artist && (
              <FilterChip label={artistName ?? state.artist} kind="Artist" onRemove={() => set({ artist: null })} />
            )}
            {state.game && <FilterChip label={gameInfo(state.game).name} kind="Game" onRemove={() => set({ game: null })} />}
            {state.category && (
              <FilterChip label={categoryInfo(state.category).name} kind="Category" onRemove={() => set({ category: null })} />
            )}
            {state.year !== null && <FilterChip label={String(state.year)} kind="Year" onRemove={() => set({ year: null })} />}
            {state.video && <FilterChip label="Has music video" kind="Video" onRemove={() => set({ video: false })} />}
            {filterCount > 1 && (
              <Button
                variant="ghost"
                size="xs"
                className="rounded-full text-muted-foreground hover:text-gold"
                onClick={() =>
                  set({ q: "", artist: null, game: null, category: null, year: null, video: false })
                }
              >
                Clear all
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const triggerClass =
  "h-9! shrink-0 rounded-full border-white/10 bg-white/[0.03] pr-2.5 pl-3.5 font-medium dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
/** Let the item text span fill the row so the song count can sit at the right edge. */
const countedItemClass = "*:[span]:last:flex-1 *:[span]:last:min-w-0"
const activeTriggerClass = "border-gold/50 bg-gold/10 text-gold dark:bg-gold/10 [&_svg]:text-gold"

function FacetSelect({
  label,
  allLabel,
  value,
  options,
  format,
  onChange,
  renderDot,
}: {
  readonly label: string
  readonly allLabel: string
  readonly value: string | null
  readonly options: ReadonlyArray<FacetOption>
  readonly format: (id: string) => string
  readonly onChange: (value: string | null) => void
  readonly renderDot?: (id: string) => string
}) {
  // A filter from the URL whose facet has no songs any more still shows (and can be cleared).
  const list = value && !options.some((o) => o.id === value) ? [{ id: value, name: format(value), count: 0 }, ...options] : options
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger aria-label={label} className={cn(triggerClass, "max-w-56", value && activeTriggerClass)}>
        <SelectValue placeholder={label}>{value ? format(value) : allLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        <SelectSeparator />
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id} className={countedItemClass}>
            {renderDot && (
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: renderDot(o.id) }} />
            )}
            <span className="truncate">{o.name}</span>
            {o.count > 0 && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{o.count}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FilterChip({ kind, label, onRemove }: { readonly kind: string; readonly label: string; readonly onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-gold/30 bg-gold/10 pr-1 pl-3 text-xs text-gold">
      <span className="text-gold/60">{kind}:</span>
      <span className="max-w-48 truncate font-medium">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${kind.toLowerCase()} filter ${label}`}
        className="grid size-5 place-items-center rounded-full transition-colors hover:bg-gold/20 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}
