"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, Mic2Icon, PlayIcon, SearchIcon } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatViews } from "@workspace/ui/components/riot/format"
import { siteNav } from "@workspace/ui/lib/site-nav"
import { cn } from "@workspace/ui/lib/utils"
import { ApiRequestError, searchArchive, type SearchResults } from "@/lib/api-client"
import { usePlayer } from "@/components/player/player-provider"

const SearchContext = React.createContext<{ readonly open: () => void } | null>(null)

/** Open the ⌘K palette from anywhere (e.g. a hero search box). */
export function useSearchCommand() {
  return React.useContext(SearchContext)
}

/**
 * Global ⌘K / Ctrl+K search palette over `/api/search` (songs + artists) and
 * the site sections. Wrap the header with it; `SearchTrigger` opens it.
 */
export function SearchCommandProvider({ children }: { readonly children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const ctx = React.useMemo(() => ({ open: () => setOpen(true) }), [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        if (t?.closest("input, textarea, select, [contenteditable=true]")) return
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <SearchContext.Provider value={ctx}>
      {children}
      <SearchDialog open={open} onOpenChange={setOpen} />
    </SearchContext.Provider>
  )
}

/**
 * Button that opens the palette. `expand`: when the label and shortcut are shown
 * ("always", or from the `lg` / `xl` breakpoint up; icon-only below).
 */
export function SearchTrigger({
  className,
  expand = "always",
}: {
  readonly className?: string
  readonly expand?: "always" | "lg" | "xl"
}) {
  const search = useSearchCommand()
  const show = expand === "always" ? "inline-flex" : expand === "lg" ? "hidden lg:inline-flex" : "hidden xl:inline-flex"
  return (
    <button
      type="button"
      onClick={() => search?.open()}
      className={cn(
        "group flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        className,
      )}
      aria-label="Search the archive"
    >
      <SearchIcon className="size-4" />
      <span className={cn("flex-1 text-left", show)}>Search songs, artists…</span>
      <KbdGroup className={show}>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </button>
  )
}

function SearchDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const player = usePlayer()
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResults | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length === 0) {
      setResults(null)
      setLoading(false)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      searchArchive(q, ctrl.signal)
        .then((r) => {
          setResults(r)
          setError(null)
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return
          setError(
            e instanceof ApiRequestError && e.code === "database-missing"
              ? "The archive database has not been built yet."
              : "Search failed — try again.",
          )
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    }, 140)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, open])

  const go = (href: string, astro?: boolean) => {
    onOpenChange(false)
    if (astro) window.location.assign(href)
    else router.push(href)
  }

  const q = query.trim().toLowerCase()
  const pages = siteNav.filter((item) => q.length === 0 || item.label.toLowerCase().includes(q))

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery("")
      }}
      title="Search the archive"
      description="Find songs, artists and sections"
      className="sm:max-w-xl"
    >
      {/* Results come from the server already ranked: no client-side filtering. */}
      <Command shouldFilter={false} loop>
      <CommandInput placeholder="Search songs, artists, games…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[60vh]">
        {loading && results === null && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </div>
        )}
        {error && <div className="py-6 text-center text-sm text-muted-foreground">{error}</div>}
        {!loading && !error && q.length > 0 && results && results.songs.length === 0 && results.artists.length === 0 && pages.length === 0 && (
          <CommandEmpty>No results for “{query}”.</CommandEmpty>
        )}

        {results && results.songs.length > 0 && (
          <CommandGroup heading="Songs">
            {results.songs.map((song) => (
              <CommandItem key={song.id} value={`song:${song.id}`} onSelect={() => go(`/songs/${song.id}`)} className="gap-3">
                <SongArtwork
                  title={song.title}
                  coverUrl={song.coverUrl}
                  palette={song.palette}
                  seed={song.id}
                  animatedBackdrop={false}
                  className="size-9 shrink-0 rounded"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{song.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {song.displayArtist}
                    {song.year ? ` · ${song.year}` : ""}
                    {formatViews(song.viewCount) ? ` · ${formatViews(song.viewCount)}` : ""}
                  </span>
                </span>
                {song.audioUrl && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Play ${song.title}`}
                    onPointerDown={(e) => {
                      // Play without navigating: stop cmdk from selecting the item.
                      e.preventDefault()
                      e.stopPropagation()
                      player.play(song, results.songs)
                      onOpenChange(false)
                    }}
                    className="grid size-7 place-items-center rounded-full bg-white/10 text-foreground opacity-70 hover:bg-gold hover:text-[#0c1d2e] hover:opacity-100"
                  >
                    <PlayIcon className="size-3.5 fill-current" />
                  </span>
                )}
              </CommandItem>
            ))}
            {results.totalSongs > results.songs.length && (
              <CommandItem value="all-songs" onSelect={() => go(`/songs?q=${encodeURIComponent(query.trim())}`)}>
                <ArrowRightIcon />
                See all {results.totalSongs} songs for “{query.trim()}”
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {results && results.artists.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Artists">
              {results.artists.map((artist) => (
                <CommandItem key={artist.id} value={`artist:${artist.id}`} onSelect={() => go(`/artists/${artist.id}`)}>
                  <Mic2Icon />
                  <span className="flex-1 truncate">{artist.name}</span>
                  <CommandShortcut>{artist.songCount} songs</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {pages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              {pages.map((item) => (
                <CommandItem key={item.href} value={`page:${item.href}`} onSelect={() => go(item.href, item.astro)}>
                  <ArrowRightIcon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
