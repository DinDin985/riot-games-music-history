import type { Metadata } from "next"
import Link from "next/link"
import { TvMinimalPlayIcon } from "lucide-react"
import type { Game, SongSummary } from "@workspace/db/domain/types"
import { formatNumber, pluralize } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { distinctCovers } from "@/lib/artwork"
import { getGames, hasDatabase } from "@/lib/server/repo"
import { categoryInfo } from "@/lib/taxonomy"
import { collectionStats, getAllSongs, yearSpan, type CollectionStats } from "../categories/_components/collection-data"
import { CoverMosaic } from "../categories/_components/cover-mosaic"
import { PageIntro } from "../categories/_components/page-intro"

export const metadata: Metadata = {
  title: "Games",
  description:
    "Riot Games music by game: League of Legends, VALORANT, Arcane, Teamfight Tactics, Wild Rift, 2XKO and Riot Forge.",
}

export default async function GamesPage() {
  if (!hasDatabase()) return <DatabaseMissing />

  const [games, songs] = await Promise.all([getGames(), getAllSongs()])
  const cards = games.map((game) => {
    const inGame = songs.filter((s) => s.gameId === game.id)
    return { game, songs: inGame, stats: collectionStats(inGame, 3) }
  })
  // Albums can span games, so each mosaic gets covers no other card shows (grid of up to 3 columns).
  const covers = distinctCovers(cards.map((c) => c.songs), 3, 3)
  const withSongs = cards.filter((c) => c.game.songCount > 0)

  return (
    <div className="flex flex-col">
      <PageIntro
        eyebrow="Across the universe"
        title="Games"
        seed="games"
        description="Every Riot title has its own sound — from League's champion themes and Worlds anthems to VALORANT's agent tracks, Arcane's soundtrack and the 2XKO fighters."
        stats={[
          { label: "games", value: formatNumber(withSongs.length) },
          { label: "songs", value: formatNumber(songs.length) },
          {
            label: "music videos",
            value: formatNumber(songs.filter((s) => s.hasVideo).length),
          },
        ]}
      />
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-4 px-4 pb-16 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
        {cards.map(({ game, stats }, i) => (
          <GameCard key={game.id} game={game} stats={stats} covers={covers[i] ?? []} />
        ))}
      </div>
    </div>
  )
}

function GameCard({
  game,
  stats,
  covers,
}: {
  readonly game: Game
  readonly stats: CollectionStats
  readonly covers: ReadonlyArray<SongSummary>
}) {
  const span = yearSpan(stats.firstYear, stats.lastYear)
  const empty = game.songCount === 0
  return (
    <Link
      href={`/games/${game.id}`}
      style={{ "--game": game.color } as React.CSSProperties}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-card/40 transition-[transform,background-color,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--game)_55%,transparent)] hover:bg-card/75 hover:shadow-[0_24px_48px_-24px_color-mix(in_oklab,var(--game)_45%,black)] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
    >
      <CoverMosaic
        songs={covers}
        seed={game.id}
        fallbackPalette={[game.color, "#0c1d2e", game.color, "#173149"]}
        className={empty ? "aspect-[16/9] opacity-60 saturate-50" : "aspect-[16/9]"}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(to top, #0c1d2e 0%, color-mix(in oklab, ${game.color} 22%, transparent) 45%, transparent 75%)`,
          }}
        />
        <span
          className="pointer-events-none absolute bottom-2 left-4 font-display text-6xl leading-none tracking-wide drop-shadow-[0_4px_18px_rgb(0_0_0/0.7)] md:text-7xl"
          style={{ color: game.color }}
        >
          {game.short}
        </span>
      </CoverMosaic>
      <span aria-hidden className="h-1 w-full" style={{ backgroundColor: game.color }} />
      <div className="flex flex-1 flex-col gap-2 p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-3xl leading-none md:text-4xl">{game.name}</h2>
          <span className="shrink-0 text-[11px] font-semibold tracking-[0.2em] uppercase" style={{ color: game.color }}>
            {empty ? "Coming soon" : pluralize(game.songCount, "song")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {span && <span className="tabular-nums">{span}</span>}
          {stats.videoCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <TvMinimalPlayIcon className="size-3.5" style={{ color: game.color }} />{" "}
              {pluralize(stats.videoCount, "music video")}
            </span>
          )}
          {empty && <span>No songs in the archive yet</span>}
        </div>
        {stats.byCategory.length > 0 && (
          <ul className="mt-auto flex flex-wrap gap-1.5 pt-2" aria-label="Top categories">
            {stats.byCategory.slice(0, 4).map((c) => (
              <li
                key={c.id}
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 text-[11px] text-foreground/80"
              >
                {categoryInfo(c.id).name}
                <span className="text-muted-foreground tabular-nums">{formatNumber(c.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  )
}
