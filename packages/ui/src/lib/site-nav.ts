/**
 * Primary navigation shared by the Next.js app and the Astro story pages so the
 * two frameworks render the same header. `/awards` and `/impact` are Astro
 * pages (full page loads); everything else is Next.js.
 */
export interface SiteNavItem {
  readonly href: string
  readonly label: string
  /** Rendered by Astro (static) rather than the Next.js app. */
  readonly astro?: boolean
}

export const siteNav: ReadonlyArray<SiteNavItem> = [
  { href: "/", label: "Home" },
  { href: "/songs", label: "Library" },
  { href: "/timeline", label: "Timeline" },
  { href: "/categories", label: "Categories" },
  { href: "/games", label: "Games" },
  { href: "/artists", label: "Artists" },
  { href: "/impact", label: "Impact", astro: true },
  { href: "/awards", label: "Awards", astro: true },
]

export const siteName = "Riot Games Music Archive"

/** localStorage key the Next.js player persists to and the Astro pages resume from. */
export const PLAYER_STORAGE_KEY = "riot-music:player"

export interface PersistedPlayerState {
  readonly songId: string
  readonly title: string
  readonly displayArtist: string
  readonly audioUrl: string
  readonly coverUrl: string | null
  readonly palette: ReadonlyArray<string>
  readonly time: number
  readonly volume: number
  readonly queue: ReadonlyArray<string>
  readonly savedAt: number
}
