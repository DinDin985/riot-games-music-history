import type { ArtistKind, ArtistRole } from "@workspace/db/domain/types"

/** Labels and groupings for artist kinds / credit roles (client- and server-safe). */

/** The in-house "Riot Games Music" credit: shown on its own, never mixed into the collaborator grid. */
export const RIOT_IN_HOUSE_ID = "riot-games-music"

export const KIND_LABEL: Readonly<Record<ArtistKind, string>> = {
  artist: "Artist",
  band: "Band",
  "virtual-group": "Virtual group",
  composer: "Composer",
  orchestra: "Orchestra",
}

export type KindTab = "all" | "artist" | "band" | "virtual-group" | "composer"

export const KIND_TABS: ReadonlyArray<{
  readonly value: KindTab
  readonly label: string
  /** Kinds shown under the tab (null = every kind). */
  readonly kinds: ReadonlyArray<ArtistKind> | null
}> = [
  { value: "all", label: "All", kinds: null },
  { value: "artist", label: "Artists", kinds: ["artist"] },
  { value: "band", label: "Bands", kinds: ["band", "orchestra"] },
  { value: "virtual-group", label: "Virtual groups", kinds: ["virtual-group"] },
  { value: "composer", label: "Composers", kinds: ["composer"] },
]

export const isKindTab = (value: string | undefined): value is KindTab => KIND_TABS.some((t) => t.value === value)

export type ArtistSortKey = "songs" | "name"

export const ROLE_LABEL: Readonly<Record<ArtistRole, string>> = {
  primary: "Artist",
  featured: "Featured",
  remixer: "Remixer",
  composer: "Composer",
}

/** Plural headings for the role filter. */
export const ROLE_FILTER_LABEL: Readonly<Record<ArtistRole, string>> = {
  primary: "As artist",
  featured: "Featured",
  remixer: "Remixes",
  composer: "Composed",
}

export const ROLE_ORDER: ReadonlyArray<ArtistRole> = ["primary", "featured", "remixer", "composer"]

/** Two-letter initials: first + last word ("Imagine Dragons" → "ID"), or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s/_-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0)
  if (words.length === 0) return "?"
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase()
  return `${Array.from(words[0]!)[0]}${Array.from(words[words.length - 1]!)[0]}`.toUpperCase()
}

/** Lower-case, accent-free text for search. */
export function searchKey(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
}
