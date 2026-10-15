/**
 * /awards island: spotlight shortcuts, filters (music-related, result, project,
 * text search) and a year-grouped timeline of award cards. Filters are mirrored
 * in the query string (?music=1&result=won&project=Arcane&spotlight=emmy&q=)
 * so filtered views can be shared.
 */
import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Music2, Search, Sparkles, Trophy, X } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { hostOf, plural } from "../../lib/format.ts"
import type { Award, GameInfo } from "../../lib/types.ts"

export interface AwardsExplorerProps {
  readonly awards: ReadonlyArray<Award>
  readonly games: Readonly<Record<string, GameInfo>>
}

type ResultFilter = "all" | "won" | "nominated"

interface Spotlight {
  readonly id: string
  readonly label: string
  readonly test: (a: Award) => boolean
}

const haystack = (a: Award) => `${a.organization} ${a.ceremony} ${a.award}`

/** Shortcuts to the recognitions people look for first. */
const SPOTLIGHTS: ReadonlyArray<Spotlight> = [
  { id: "emmy", label: "Emmys", test: (a) => /\bemmy|television academy/i.test(haystack(a)) },
  { id: "annie", label: "Annie Awards", test: (a) => /\bannie awards?\b/i.test(haystack(a)) },
  {
    id: "charts",
    label: "Charts & records",
    test: (a) =>
      /\b(charts?|records?|guinness|certif\w*|no\.\s?1|number one)\b|#1\b/i.test(`${haystack(a)} ${a.notes ?? ""}`) &&
      !/\brecording academy\b/i.test(a.organization),
  },
  { id: "grammy", label: "Grammys", test: (a) => /\bgramm(y|ies)|recording academy/i.test(haystack(a)) },
  { id: "game-awards", label: "The Game Awards", test: (a) => /\bthe game awards\b/i.test(haystack(a)) },
]

/** Projects users ask about first; others follow by number of entries. */
const PREFERRED_PROJECTS = ["Arcane", "K/DA", "Worlds", "VALORANT", "League of Legends", "True Damage", "HEARTSTEEL"]

export default function AwardsExplorer({ awards, games }: AwardsExplorerProps) {
  const [musicOnly, setMusicOnly] = useState(false)
  const [result, setResult] = useState<ResultFilter>("all")
  const [project, setProject] = useState<string>("all")
  const [spotlight, setSpotlight] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  // Restore filters from the URL after hydration (the static HTML shows everything).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setMusicOnly(params.get("music") === "1")
    const r = params.get("result")
    if (r === "won" || r === "nominated") setResult(r)
    const p = params.get("project")
    if (p && awards.some((a) => a.project === p)) setProject(p)
    const s = params.get("spotlight")
    if (s && SPOTLIGHTS.some((x) => x.id === s)) setSpotlight(s)
    setQuery(params.get("q") ?? "")
  }, [awards])

  useEffect(() => {
    const params = new URLSearchParams()
    if (musicOnly) params.set("music", "1")
    if (result !== "all") params.set("result", result)
    if (project !== "all") params.set("project", project)
    if (spotlight) params.set("spotlight", spotlight)
    if (query.trim()) params.set("q", query.trim())
    const search = params.toString()
    const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(null, "", url)
  }, [musicOnly, result, project, spotlight, query])

  const projects = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of awards) counts.set(a.project, (counts.get(a.project) ?? 0) + 1)
    const rank = (p: string) => {
      const i = PREFERRED_PROJECTS.indexOf(p)
      return i === -1 ? PREFERRED_PROJECTS.length : i
    }
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [awards])

  const spotlights = useMemo(
    () =>
      SPOTLIGHTS.map((s) => {
        const matching = awards.filter(s.test)
        return { ...s, total: matching.length, wins: matching.filter((a) => a.result === "won").length }
      }).filter((s) => s.total > 0),
    [awards],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const activeSpotlight = SPOTLIGHTS.find((s) => s.id === spotlight)
    return awards.filter(
      (a) =>
        (!musicOnly || a.musicRelated) &&
        (result === "all" || a.result === result) &&
        (project === "all" || a.project === project) &&
        (!activeSpotlight || activeSpotlight.test(a)) &&
        (!needle ||
          `${haystack(a)} ${a.recipient} ${a.project} ${a.songTitle ?? ""} ${a.notes ?? ""} ${a.year}`
            .toLowerCase()
            .includes(needle)),
    )
  }, [awards, musicOnly, result, project, spotlight, query])

  const byYear = useMemo(() => {
    const groups = new Map<number, Array<Award>>()
    for (const a of filtered) groups.set(a.year, [...(groups.get(a.year) ?? []), a])
    return [...groups.entries()].sort((a, b) => b[0] - a[0])
  }, [filtered])

  const wins = filtered.filter((a) => a.result === "won").length
  const filtersActive = musicOnly || result !== "all" || project !== "all" || spotlight !== null || query.trim() !== ""
  const reset = () => {
    setMusicOnly(false)
    setResult("all")
    setProject("all")
    setSpotlight(null)
    setQuery("")
  }

  return (
    <div className="flex flex-col gap-8">
      {spotlights.length > 0 ? (
        <section aria-label="Spotlights" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {spotlights.map((s) => {
            const active = spotlight === s.id
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSpotlight(active ? null : s.id)}
                className={cn(
                  "group flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:border-gold/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "border-gold bg-gold/10",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  <Sparkles className="size-3.5 text-gold" aria-hidden="true" />
                  Spotlight
                </span>
                <span className="text-base font-semibold">{s.label}</span>
                <span className="text-sm text-muted-foreground">
                  {s.wins > 0 ? plural(s.wins, "win") : plural(s.total, "nomination")}
                  {s.wins > 0 && s.total > s.wins ? ` · ${s.total - s.wins} nominated` : ""}
                </span>
              </button>
            )
          })}
        </section>
      ) : null}

      <section aria-label="Filters" className="flex flex-col gap-4 rounded-xl border bg-card/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={musicOnly ? "music" : "all"}
              onValueChange={(v) => v && setMusicOnly(v === "music")}
              aria-label="Scope"
            >
              <ToggleGroupItem value="all">All awards</ToggleGroupItem>
              <ToggleGroupItem value="music">
                <Music2 data-icon="inline-start" />
                Music-related
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={result}
              onValueChange={(v) => v && setResult(v as ResultFilter)}
              aria-label="Result"
            >
              <ToggleGroupItem value="all">Any result</ToggleGroupItem>
              <ToggleGroupItem value="won">
                <Trophy data-icon="inline-start" />
                Won
              </ToggleGroupItem>
              <ToggleGroupItem value="nominated">Nominated</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ceremony, category, recipient…"
              aria-label="Search awards"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Project">
          {[["all", awards.length] as const, ...projects].map(([name, count]) => {
            const active = project === name
            return (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => setProject(active && name !== "all" ? "all" : name)}
                className="rounded-full"
              >
                {name === "all" ? "All projects" : name}
                <span className={cn("tabular-nums", active ? "opacity-70" : "text-muted-foreground")}>{count}</span>
              </Button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground" aria-live="polite">
          <span>
            Showing <strong className="text-foreground">{filtered.length}</strong> of {awards.length} ·{" "}
            {plural(wins, "win")}
          </span>
          {filtersActive ? (
            <Button type="button" size="xs" variant="ghost" onClick={reset}>
              <X data-icon="inline-start" />
              Clear filters
            </Button>
          ) : null}
          {byYear.length > 1 ? (
            <nav aria-label="Jump to year" className="flex flex-wrap gap-1 lg:ml-auto">
              {byYear.map(([year]) => (
                <a
                  key={year}
                  href={`#year-${year}`}
                  className="rounded-md px-1.5 py-0.5 text-xs tabular-nums hover:bg-muted hover:text-foreground"
                >
                  {year}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      {byYear.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <Trophy className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-muted-foreground">
            {awards.length === 0 ? "Awards research is still in progress." : "No awards match these filters."}
          </p>
          {filtersActive ? (
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <ol className="flex flex-col gap-10">
          {byYear.map(([year, items]) => {
            const yearWins = items.filter((a) => a.result === "won").length
            return (
              <li key={year} id={`year-${year}`} className="grid scroll-mt-24 gap-4 md:grid-cols-[7rem_minmax(0,1fr)]">
                <div className="md:sticky md:top-24 md:self-start">
                  <h2 className="text-3xl font-bold tracking-tight tabular-nums md:text-4xl">{year}</h2>
                  <p className="text-sm text-muted-foreground">
                    {plural(yearWins, "win")}
                    {items.length > yearWins ? ` · ${items.length - yearWins} nom.` : ""}
                  </p>
                </div>
                <ul className="grid gap-3 border-l border-border pl-4 sm:grid-cols-2 md:pl-6 xl:grid-cols-3">
                  {items.map((award) => (
                    <li key={award.id} className="flex">
                      <AwardCard award={award} game={award.gameId ? games[award.gameId] : undefined} />
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function AwardCard({ award, game }: { readonly award: Award; readonly game: GameInfo | undefined }) {
  const won = award.result === "won"
  return (
    <Card size="sm" className={cn("w-full gap-3", won && "ring-gold/35")}>
      <CardHeader className="gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{award.organization}</p>
          {won ? (
            <Badge className="shrink-0 bg-gold text-[#0c1d2e]">
              <Trophy data-icon="inline-start" />
              Won
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              Nominated
            </Badge>
          )}
        </div>
        <h3 className="leading-snug font-semibold">{award.award}</h3>
        <p className="text-sm text-muted-foreground">{award.ceremony}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-sm">{award.recipient}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            <span
              className="size-2 rounded-full"
              style={{ background: game?.color ?? "var(--gold)" }}
              aria-hidden="true"
            />
            {award.project}
          </Badge>
          {game && game.name !== award.project ? <Badge variant="outline">{game.short}</Badge> : null}
          {award.musicRelated ? (
            <Badge variant="outline">
              <Music2 data-icon="inline-start" />
              Music
            </Badge>
          ) : null}
          {award.songTitle ? (
            award.songId ? (
              <Badge asChild variant="outline">
                <a href={`/songs/${encodeURIComponent(award.songId)}`}>♪ {award.songTitle}</a>
              </Badge>
            ) : (
              <Badge variant="outline">♪ {award.songTitle}</Badge>
            )
          ) : null}
        </div>
        {award.notes ? <p className="text-xs leading-relaxed text-muted-foreground">{award.notes}</p> : null}
      </CardContent>
      {award.sourceUrls.length > 0 ? (
        <CardFooter className="flex-wrap gap-x-3 gap-y-1 text-xs">
          {award.sourceUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {hostOf(url)}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ))}
        </CardFooter>
      ) : null}
    </Card>
  )
}
