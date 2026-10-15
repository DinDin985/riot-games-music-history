import type { Metadata } from "next"
import { formatNumber } from "@workspace/ui/components/riot/format"
import { DatabaseMissing } from "@/components/database-missing"
import { getArtist, hasDatabase, listArtists } from "@/lib/server/repo"
import { GAMES } from "@/lib/taxonomy"
import { searchParam } from "../categories/_components/collection-data"
import { PageIntro } from "../categories/_components/page-intro"
import { ArtistBrowser } from "./_components/artist-browser"
import type { ArtistCardData } from "./_components/artist-card"
import { InHouseCard } from "./_components/in-house-card"
import { RIOT_IN_HOUSE_ID, isKindTab } from "./_components/artist-meta"

export const metadata: Metadata = {
  title: "Artists",
  description:
    "Every artist, band, virtual group and composer who has made music with Riot Games — from Imagine Dragons and K/DA to the composers behind the game soundtracks.",
}

interface Props {
  readonly searchParams: Promise<Record<string, string | Array<string> | undefined>>
}

const gameOrder = new Map(GAMES.map((g, i) => [g.id, i]))

export default async function ArtistsPage({ searchParams }: Props) {
  if (!hasDatabase()) return <DatabaseMissing />

  const [artists, query, inHouse] = await Promise.all([listArtists(), searchParams, getArtist(RIOT_IN_HOUSE_ID)])
  // Slim, client-bound payload; game badges in taxonomy order.
  const collaborators: Array<ArtistCardData> = artists
    .filter((a) => a.id !== RIOT_IN_HOUSE_ID)
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      songCount: a.songCount,
      gameIds: [...a.gameIds].sort((x, y) => (gameOrder.get(x) ?? 99) - (gameOrder.get(y) ?? 99)),
      coverUrl: a.coverUrl,
      palette: a.palette.slice(0, 4),
    }))
  const count = (...kinds: ReadonlyArray<string>) => collaborators.filter((a) => kinds.includes(a.kind)).length

  const kind = searchParam(query, "kind")
  const sort = searchParam(query, "sort")

  return (
    <div className="flex flex-col">
      <PageIntro
        eyebrow="The people behind the music"
        title="Artists"
        seed="artists"
        description="Every artist, band, virtual group and composer who has collaborated with Riot Games on a song in the archive — featured vocalists, remixers and the composers behind every theme."
        stats={[
          { label: "collaborators", value: formatNumber(collaborators.length) },
          { label: "artists", value: formatNumber(count("artist")) },
          { label: "bands", value: formatNumber(count("band", "orchestra")) },
          {
            label: "virtual groups",
            value: formatNumber(count("virtual-group")),
          },
          { label: "composers", value: formatNumber(count("composer")) },
        ]}
      />
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-10 px-4 pb-16 md:px-6">
        {inHouse && inHouse.songs.length > 0 && <InHouseCard artist={inHouse} />}
        <section aria-labelledby="collaborators-heading">
          <h2 id="collaborators-heading" className="mb-4 text-4xl leading-none md:text-5xl">
            {formatNumber(collaborators.length)} collaborators
          </h2>
          <ArtistBrowser
            artists={collaborators}
            initialQuery={searchParam(query, "q")?.slice(0, 100) ?? ""}
            initialKind={isKindTab(kind) ? kind : "all"}
            initialSort={sort === "name" ? "name" : "songs"}
          />
        </section>
      </div>
    </div>
  )
}
