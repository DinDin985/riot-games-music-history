import type { ArtistKind, ArtistRole } from "@workspace/db/domain/types"
import type { CatalogArtist } from "./types.ts"
import { fnv1a, nameKey, slugify } from "./normalize.ts"

/**
 * Artist identity rules: label pseudo-artists, spelling aliases, artist kinds
 * and the registry that turns raw credit names into stable slug ids.
 */

export const RIOT_GAMES_MUSIC: CatalogArtist = { id: "riot-games-music", name: "Riot Games Music", kind: "composer" }

/**
 * Topic channels list the label/brand as the first "artist" of every art
 * track ("League of Legends · Against The Current"). These are not
 * collaborators; several of them do tell us which game a track belongs to.
 */
const LABELS: Readonly<Record<string, string | null>> = {
  leagueoflegends: null,
  riotgames: null,
  riotgamesinc: null,
  valorant: "valorant",
  "2xko": "2xko",
  legendsofruneterra: "legends-of-runeterra",
  teamfighttactics: "teamfight-tactics",
  arcane: "arcane",
  arcaneleagueoflegends: "arcane",
  riotforge: "riot-forge",
  leagueoflegendswildrift: "wild-rift",
  wildrift: "wild-rift",
}

export const isLabel = (name: string): boolean => nameKey(name) in LABELS

/** Game implied by a label pseudo-artist ("VALORANT" → valorant), if any. */
export const labelGame = (name: string): string | null => LABELS[nameKey(name)] ?? null

/** Spelling variants that are the same act (key → canonical key). */
const ALIASES: Readonly<Record<string, string>> = {
  idle: "gidle", // (G)I-DLE renamed to i-dle in 2025
  gidle: "gidle",
  nickytaylor: "nickitaylor",
  jeremymckinnonofadaytoremember: "jeremymckinnon",
  ghostwritermusic: "ghostwriter",
  riotmusicteam: "riotgamesmusic",
}

/** Preferred spelling for a canonical key (otherwise the most frequent variant wins). */
const PREFERRED_NAMES: Readonly<Record<string, string>> = {
  gidle: "(G)I-DLE",
  jeremymckinnon: "Jeremy McKinnon",
  riotgamesmusic: "Riot Games Music",
  protoshredanoid: "ProtoShredanoid",
  kda: "K/DA",
}

export const artistKey = (name: string): string => {
  const key = nameKey(name)
  return ALIASES[key] ?? key
}

/** In-universe acts (Riot's virtual bands and idols). */
const VIRTUAL_GROUPS = new Set(["kda", "truedamage", "pentakill", "heartsteel", "sentinelsoflight", "seraphine"])

/** Real-world bands, duos and groups that collaborated with Riot. */
const BANDS = new Set([
  "imaginedragons",
  "againstthecurrent",
  "linkinpark",
  "theglitchmob",
  "pvris",
  "twentyonepilots",
  "thewordalive",
  "thecrystalmethod",
  "fever333",
  "yonaka",
  "bonesuk",
  "spiritbox",
  "polyphia",
  "health",
  "djerv",
  "twice",
  "gidle",
  "newjeans",
  "kissoflife",
  "xg",
  "straykids",
  "katseye",
  "coldplay",
  "adaytoremember",
  "foreignair",
  "mako",
  "grey",
  "leftright",
  "groovyroom",
  "dadalife",
  "vicetone",
  "wavedash",
  "twofeathers",
  "theseige",
  "2wei",
  "meduza",
  "thebloodybeatroots",
  "chillhopmusic",
])

const ORCHESTRA = /orchestra|philharmoni|symphon|chamber singers|choir|ensemble/i

export const isVirtualGroup = (name: string): boolean => VIRTUAL_GROUPS.has(artistKey(name))

export const artistKind = (name: string, roles: ReadonlySet<ArtistRole>): ArtistKind => {
  const key = artistKey(name)
  if (key === "riotgamesmusic") return "composer"
  if (VIRTUAL_GROUPS.has(key)) return "virtual-group"
  if (BANDS.has(key)) return "band"
  if (ORCHESTRA.test(name)) return "orchestra"
  if (roles.size > 0 && [...roles].every((r) => r === "composer")) return "composer"
  return "artist"
}

/**
 * Collects every spelling of every credited name, then assigns one display
 * name and one unique slug id per canonical key. Ids are assigned in key order
 * so the result does not depend on the order songs were processed in.
 */
export class ArtistRegistry {
  private readonly variants = new Map<string, Map<string, number>>()
  private readonly roles = new Map<string, Set<ArtistRole>>()
  private resolved: Map<string, CatalogArtist> | null = null

  add(name: string, role: ArtistRole): string {
    const key = artistKey(name)
    const counts = this.variants.get(key) ?? new Map<string, number>()
    counts.set(name, (counts.get(name) ?? 0) + 1)
    this.variants.set(key, counts)
    const roles = this.roles.get(key) ?? new Set<ArtistRole>()
    roles.add(role)
    this.roles.set(key, roles)
    this.resolved = null
    return key
  }

  private resolve(): Map<string, CatalogArtist> {
    if (this.resolved) return this.resolved
    const used = new Set<string>()
    const out = new Map<string, CatalogArtist>()
    for (const key of [...this.variants.keys()].sort()) {
      const counts = this.variants.get(key)!
      const name =
        PREFERRED_NAMES[key] ??
        [...counts.entries()].sort((a, b) => b[1] - a[1] || mixedCaseScore(b[0]) - mixedCaseScore(a[0]) || (a[0] < b[0] ? -1 : 1))[0]![0]
      let id = key === "riotgamesmusic" ? RIOT_GAMES_MUSIC.id : slugify(name) || `artist-${fnv1a(name)}`
      if (used.has(id)) {
        let n = 2
        while (used.has(`${id}-${n}`)) n++
        id = `${id}-${n}`
      }
      used.add(id)
      out.set(key, { id, name, kind: artistKind(name, this.roles.get(key) ?? new Set()) })
    }
    this.resolved = out
    return out
  }

  get(key: string): CatalogArtist {
    const artist = this.resolve().get(key)
    if (!artist) throw new Error(`Unknown artist key ${key}`)
    return artist
  }

  all(): ReadonlyArray<CatalogArtist> {
    return [...this.resolve().values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

/** Prefer "Vic Mensa" over "VIC MENSA" / "vic mensa" when variants are equally frequent. */
const mixedCaseScore = (name: string): number => (/[a-z]/.test(name) && /[A-Z]/.test(name) ? 1 : 0)
