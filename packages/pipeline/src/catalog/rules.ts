import type { VideoKind } from "@workspace/db/domain/types"
import { fold } from "./normalize.ts"

/**
 * Classification rules for the catalog: category/game heuristics from album
 * names and titles, category priority, and music-video ranking.
 */

/** `primaryCategoryId` is the first category of a song in this order. */
export const CATEGORY_PRIORITY: ReadonlyArray<string> = [
  "arcane",
  "worlds",
  "worlds-theme",
  "msi",
  "valorant-champions",
  "virtual-group",
  "champion-theme",
  "cinematic",
  "login-screen",
  "skin-line",
  "esports",
  "soundtrack",
  "remix",
]

export const FALLBACK_CATEGORY = "soundtrack"
export const FALLBACK_GAME = "riot-games"

export const primaryCategory = (categories: Iterable<string>): string => {
  const set = new Set(categories)
  return CATEGORY_PRIORITY.find((c) => set.has(c)) ?? [...set].sort()[0] ?? FALLBACK_CATEGORY
}

/** Category order used for `categoryIds` (priority order, unknown ids last, alphabetical). */
export const sortCategories = (categories: Iterable<string>): ReadonlyArray<string> =>
  [...new Set(categories)].sort((a, b) => {
    const ia = CATEGORY_PRIORITY.indexOf(a)
    const ib = CATEGORY_PRIORITY.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0)
  })

// ---------------------------------------------------------------------------
// Music video ranking

/** Which video best represents a song in the "Watch music video" popup. */
export const MV_KIND_PRIORITY: ReadonlyArray<VideoKind> = [
  "music_video",
  "cinematic",
  "skin_trailer_song",
  "lyric_video",
  "animated_short",
  "visualizer",
  "champion_theme",
  "login_screen",
]

/** Music videos longer than this are compilations/full sets, never the popup video. */
export const MAX_MV_SECONDS = 15 * 60

export interface MvCandidate {
  readonly youtubeId: string
  readonly kind: VideoKind
  readonly role: string
  readonly mvRank: number | null
  readonly durationSeconds: number | null
  readonly viewCount: number | null
}

const kindRank = (kind: VideoKind): number => {
  const i = MV_KIND_PRIORITY.indexOf(kind)
  return i < 0 ? MV_KIND_PRIORITY.length : i
}

/** Lowest mvRank, then kind priority, then most views, then id (deterministic). */
export const compareMvCandidates = (a: MvCandidate, b: MvCandidate): number =>
  (a.mvRank ?? 99) - (b.mvRank ?? 99) ||
  kindRank(a.kind) - kindRank(b.kind) ||
  (b.viewCount ?? -1) - (a.viewCount ?? -1) ||
  (a.youtubeId < b.youtubeId ? -1 : a.youtubeId > b.youtubeId ? 1 : 0)

export const isMvEligible = (v: MvCandidate): boolean =>
  v.role === "primary_mv" && (v.durationSeconds === null || v.durationSeconds <= MAX_MV_SECONDS)

export const pickMusicVideo = <A extends MvCandidate>(videos: ReadonlyArray<A>): A | null =>
  [...videos].filter(isMvEligible).sort(compareMvCandidates)[0] ?? null

// ---------------------------------------------------------------------------
// Game heuristics

/**
 * Album/title → game for Riot's spin-off titles. The first match wins.
 * "Viego, the Ruined King" / "Viktor, the Herald of the Arcane" are champion
 * themes, hence the look-behinds.
 */
const GAME_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<!the )\bArcane\b(?=.*(?:League of Legends|Soundtrack|Score|Season|Original|Animated))|^Arcane$/i, "arcane"],
  [/\bTeamfight Tactics\b|\bTFT\b|\bRemix Rumble\b/i, "teamfight-tactics"],
  [/\bLegends of Runeterra\b|\bLoR\b/, "legends-of-runeterra"],
  [/\bWild Rift\b/i, "wild-rift"],
  [/(?<!the )\bRuined King\b|\bSong of Nunu\b|\bMageseeker\b|\bCONV\/?RGENCE\b|\bHextech Mayhem\b|\bBandle Tale\b/i, "riot-forge"],
]

export const gameFromText = (text: string | null | undefined): string | null => {
  if (!text) return null
  for (const [pattern, game] of GAME_PATTERNS) if (pattern.test(text)) return game
  return null
}

// ---------------------------------------------------------------------------
// Category heuristics

/** League of Legends champions (and 2XKO fighters, who are the same characters). */
const LOL_CHAMPIONS = `Aatrox Ahri Akali Akshan Alistar Ambessa Amumu Anivia Annie Aphelios Ashe Aurelion_Sol Aurora Azir
  Bard Bel'Veth Blitzcrank Brand Braum Briar Caitlyn Camille Cassiopeia Cho'Gath Corki Darius Diana Dr._Mundo Draven
  Ekko Elise Evelynn Ezreal Fiddlesticks Fiora Fizz Galio Gangplank Garen Gnar Gragas Graves Gwen Hecarim Heimerdinger
  Hwei Illaoi Irelia Ivern Janna Jarvan_IV Jax Jayce Jhin Jinx K'Sante Kai'Sa Kalista Karma Karthus Kassadin Katarina
  Kayle Kayn Kennen Kha'Zix Kindred Kled Kog'Maw LeBlanc Lee_Sin Leona Lillia Lissandra Lucian Lulu Lux Malphite
  Malzahar Maokai Master_Yi Mel Milio Miss_Fortune Mordekaiser Morgana Naafiri Nami Nasus Nautilus Neeko Nidalee Nilah
  Nocturne Nunu Olaf Orianna Ornn Pantheon Poppy Pyke Qiyana Quinn Rakan Rammus Rek'Sai Rell Renata_Glasc Renata
  Renekton Rengar Riven Rumble Ryze Samira Sejuani Senna Seraphine Sett Shaco Shen Shyvana Singed Sion Sivir Skarner
  Smolder Sona Soraka Swain Sylas Syndra Tahm_Kench Taliyah Talon Taric Teemo Thresh Tristana Trundle Tryndamere
  Twisted_Fate Twitch Udyr Urgot Varus Vayne Veigar Vel'Koz Vex Vi Viego Viktor Vladimir Volibear Warwick Wukong
  Xayah Xerath Xin_Zhao Yasuo Yone Yorick Yunara Yuumi Zaahen Zac Zed Zeri Ziggs Zilean Zoe Zyra`
  .split(/\s+/)
  .filter(Boolean)
  .map((n) => n.replace(/_/g, " "))

/** VALORANT agents — "(… Theme)" with an agent name is an agent theme. */
const VALORANT_AGENTS = `Astra Breach Brimstone Chamber Clove Cypher Deadlock Fade Gekko Harbor Iso Jett KAY/O Killjoy
  Neon Omen Phoenix Raze Reyna Sage Skye Sova Tejo Viper Vyse Waylay Yoru Veto`
  .split(/\s+/)
  .filter(Boolean)

const lower = (names: ReadonlyArray<string>) => new Set(names.map((n) => fold(n).toLowerCase()))
export const CHAMPIONS: ReadonlySet<string> = lower(LOL_CHAMPIONS)
export const AGENTS: ReadonlySet<string> = lower(VALORANT_AGENTS)

const SKIN_LINES =
  /\b(?:Skin Theme|Event Theme)\b|^(?:Star Guardian|Spirit Blossom|PROJECT|Coven|Battle Queens|Dragonmancer|Porcelain|PsyOps|Lunar Beasts|Lunar Revel|Winterblessed|Inkshadow|Faerie Court|Soul Fighter|Space Groove|Sentinels of Light|Bit Rush|Arcade|High Noon|Snowdown|Odyssey|Elementalist|Mecha Kingdoms|Pulsefire|Dark Star|Anima Squad|Empyrean|Crystalis|Heartsteel)\b/i

/**
 * The yearly orchestral World Championship theme (broadcast, login screen and
 * arena score) as opposed to the Worlds anthem: "2019 World Championship
 * Theme", "Season 3 World Championship", "Worlds 2016 Finals".
 */
const WORLDS_THEME =
  /^(?:(?:Season \d+|(?:19|20)\d{2}) World Championship(?: Theme)?|(?:Season \d+|Worlds (?:19|20)\d{2}) Finals|Worlds (?:(?:19|20)\d{2} )?(?:Theme|Orchestral(?: Theme)?))$/i

export const isWorldsTheme = (title: string): boolean => WORLDS_THEME.test(head(fold(title)))

/** A Worlds orchestral theme is never also filed as a Worlds anthem (videos and the wiki tag both "worlds"). */
export const splitWorlds = (categories: Set<string>, title: string): void => {
  if (!categories.has("worlds") && !categories.has("worlds-theme")) return
  if (isWorldsTheme(title)) {
    categories.delete("worlds")
    categories.add("worlds-theme")
  } else categories.delete("worlds-theme")
}

export interface CategoryContext {
  readonly title: string
  readonly album: string | null
  readonly isVirtualGroup: boolean
  readonly hasRemixer: boolean
  readonly gameId: string
  /** Extra champion/fighter names (lower-case), e.g. from the wiki. */
  readonly extraChampions?: ReadonlySet<string> | undefined
}

/** Title head before any parenthetical: "Jinx, the Loose Cannon (From …)" → "Jinx, the Loose Cannon". */
const head = (text: string): string => text.replace(/\s*[([].*$/, "").trim()

/** "Jax, the Grandmaster at Arms" / "Sona, Maven of the Strings" → "jax" / "sona". */
const epithetSubject = (text: string): string | null => {
  const match = /^([A-Z][\w'.]*(?:\s[A-Z][\w'.]*){0,2}),\s+(?:the\s+)?[A-Z]/.exec(head(fold(text)))
  return match ? match[1]!.toLowerCase() : null
}

/** "(Lux Champion Theme)" → "lux"; "(Ruined Courtyard Theme)" → "ruined courtyard". */
const themeSubjects = (title: string): ReadonlyArray<string> =>
  [...fold(title).matchAll(/\(([^()]*?)\s+(?:(?:Champion|Agent|Fighter)\s+)?Theme\)/gi)].map((m) => m[1]!.trim().toLowerCase())

export const isChampionTheme = (ctx: Pick<CategoryContext, "title" | "album" | "gameId" | "extraChampions">): boolean => {
  const known = (name: string) => CHAMPIONS.has(name) || AGENTS.has(name) || (ctx.extraChampions?.has(name) ?? false)
  if (/\b(?:Champion|Agent|Fighter) Theme\b/i.test(ctx.title)) return true
  if (themeSubjects(ctx.title).some(known)) return true
  const subject = epithetSubject(ctx.title) ?? (ctx.album ? epithetSubject(ctx.album) : null)
  if (subject && known(subject)) return true
  // VALORANT agent singles are titled after the agent ("VYSE").
  if (ctx.gameId === "valorant" && AGENTS.has(fold(head(ctx.title)).toLowerCase())) return true
  return false
}

/**
 * Categories implied by a song's own title, album and credits. Linked video
 * classifications and wiki matches add more categories on top of these.
 */
export const heuristicCategories = (ctx: CategoryContext): ReadonlySet<string> => {
  const out = new Set<string>()
  const title = fold(ctx.title)
  const album = fold(ctx.album ?? "")
  const both = `${title} | ${album}`

  if (ctx.gameId === "arcane" || gameFromText(album) === "arcane" || /[([][^)\]]*\bArcane\b[^)\]]*[)\]]/i.test(title))
    out.add("arcane")
  if (/World Championship|\bWorlds\s+(?:19|20)\d{2}\b|\bWorlds (?:Anthem|Theme|Remix|Finals|Orchestral)\b|^Worlds Collide\b/i.test(both))
    out.add("worlds")
  if (/\bMSI\b|\bMid-?\s?Season\b/i.test(both)) out.add("msi")
  if (/\bVALORANT Champions\b|\bVCT\b|\bGame Changers\b|\bChampions (?:Tour|20\d{2})\b/i.test(both)) out.add("valorant-champions")
  if (ctx.gameId === "valorant" && /\bMasters\b/.test(both)) out.add("valorant-champions")
  if (ctx.isVirtualGroup) out.add("virtual-group")
  if (isChampionTheme(ctx)) out.add("champion-theme")
  if (/\bCinematic\b/i.test(both)) out.add("cinematic")
  if (/\bLog-?in\b/i.test(both)) out.add("login-screen")
  if (SKIN_LINES.test(title) || SKIN_LINES.test(album)) out.add("skin-line")
  if (/\b(?:LCS|LEC|LCK|LPL|LTA|Rift Rivals|All-?Star|Championship of the Americas|First Stand)\b/.test(both)) out.add("esports")
  // Teamfight Tactics esports: the TFT Opens (Vegas, Macao, Paris…), Tactician's Crown / Cup.
  if (/\bTFT (?:Open|Championship|World Championship)\b|\b(?:Vegas|Macao|Paris) Open\b|\bTactician'?s (?:Crown|Cup)\b/i.test(both))
    out.add("esports")
  // "REMIX RUMBLE" is the name of TFT Set 10 and its theme, not a remix marker.
  const versionTitle = title.replace(/\bRemix Rumble\b/gi, "")
  if (
    ctx.hasRemixer ||
    /\b(?:Remix|Remixed|Remixes|VIP|Flip|Rework|Redux|Acoustic|Demo Version|Orchestral Version)\b/i.test(versionTitle)
  )
    out.add("remix")
  return out
}
