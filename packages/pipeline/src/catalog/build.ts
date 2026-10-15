import type { ArtistRole, AudioKind, VideoKind, VideoRole } from "@workspace/db/domain/types"
import { sources } from "../sources.ts"
import { ArtistRegistry, artistKey, isLabel, isVirtualGroup, labelGame, RIOT_GAMES_MUSIC } from "./artists.ts"
import type {
  CatalogInputs,
  ImpactInput,
  InfoMeta,
  SpotifyTrackInput,
  TopicTrackInput,
  VideoClassInput,
  WikiSongInput,
} from "./inputs.ts"
import {
  displayTitle,
  featuredText,
  formatDisplayArtist,
  isoDate,
  nameKey,
  normalizeTitle,
  remixGroups,
  repairMojibake,
  seasonYear,
  slugOr,
  songSlug,
  splitNames,
  yearOf,
} from "./normalize.ts"
import {
  compareMvCandidates,
  FALLBACK_CATEGORY,
  FALLBACK_GAME,
  gameFromText,
  heuristicCategories,
  isMvEligible,
  type MvCandidate,
  pickMusicVideo,
  primaryCategory,
  sortCategories,
  splitWorlds,
} from "./rules.ts"
import type { Catalog, CatalogSong, CatalogVideo } from "./types.ts"
import { type IdLockReport, idLockReport, type LockCandidate, lockSongIds } from "./id-lock.ts"

/**
 * Builds `data/catalog.json` from the loaded inputs. Pure and deterministic:
 * the same inputs always produce the same catalog (apart from `generatedAt`).
 *
 * Pipeline:
 *  1. Every Topic art track is a song candidate; true duplicates (same
 *     normalised title + performer set + duration ±3 s) are merged.
 *  2. Every classified music video is attached to a song — by `topicTrackId`,
 *     else by normalised title + overlapping performers — or creates a new song
 *     when it is a primary MV / official audio upload of a song without a Topic
 *     track (Enemy, POP/STARS, Warriors 2014 …).
 *  3. Credits, categories, game, year, music video, audio source, impact flag.
 *  4. Unique slug ids for songs and artists.
 */

/** Songs that are always impact songs, even before `data/curated/impact/<slug>.json` exists. */
export const DEFAULT_IMPACT: ReadonlyArray<ImpactInput> = [
  { slug: "warriors", song: "Warriors", artists: ["Imagine Dragons"], year: 2014, videos: [{ youtubeId: "fmI_Ndrxy14", role: "primary_mv" }] },
  { slug: "enemy", song: "Enemy", artists: ["Imagine Dragons", "JID"], year: 2021, videos: [{ youtubeId: "F5tSoaJ93ac", role: "primary_mv" }] },
  {
    slug: "legends-never-die",
    song: "Legends Never Die",
    artists: ["Against The Current"],
    year: 2017,
    videos: [{ youtubeId: "r6zIGXun57U", role: "primary_mv" }],
  },
  { slug: "pop-stars", song: "POP/STARS", artists: ["K/DA"], year: 2018, videos: [{ youtubeId: "UOxkGD8qRB4", role: "primary_mv" }] },
  { slug: "awaken", song: "Awaken", artists: ["Valerie Broussard"], year: 2019, videos: [{ youtubeId: "zF5Ddo9JdpY", role: "primary_mv" }] },
  { slug: "get-jinxed", song: "Get Jinxed", artists: ["Djerv"], year: 2013, videos: [{ youtubeId: "0nlJuwO0GDs", role: "primary_mv" }] },
  {
    slug: "silver-scrapes",
    song: "Silver Scrapes",
    artists: ["Riot Games Music", "Danny McCarthy"],
    year: 2012,
    videos: [{ youtubeId: "JNM3G5nGf0g", role: "primary_mv" }],
  },
]

/** Topic art tracks closer than this (seconds) with the same title and performers are one song. */
export const DUPLICATE_TOLERANCE_SECONDS = 3

/** Game of every Topic channel / video channel, from `sources.ts` (topic_tft → teamfight-tactics, …). */
const gamesOf = (kind: "topic" | "channel"): Readonly<Record<string, string>> =>
  Object.fromEntries(sources.flatMap((s) => (s.kind === kind && s.game ? [[s.key, s.game] as const] : [])))
const TOPIC_GAMES = gamesOf("topic")
const CHANNEL_GAMES = gamesOf("channel")
/** The League Topic channel also carries spin-off music (TFT, Arcane…), so its game is only weak evidence. */
const SHARED_TOPIC = "topic_lol"

/**
 * Albums whose art tracks are remixes released under the game label although
 * their titles carry no "(X Remix)": every non-label artist is the remixer and
 * the original is Riot's. Warsongs (2016) — "Silver Scrapes · League of
 * Legends · Protoshredanoid" is ProtoShredanoid's remix of Riot's track.
 */
export const REMIX_ALBUMS: ReadonlyArray<RegExp> = [/^Warsongs$/i]
export const isRemixAlbum = (album: string | null | undefined): boolean =>
  !!album && REMIX_ALBUMS.some((pattern) => pattern.test(album.trim()))

/**
 * Curated song descriptions, keyed by the YouTube id of the song's audio or music
 * video — for songs whose only available recording is another version than the
 * one people know, so the song page says so.
 */
export const SONG_NOTES: Readonly<Record<string, string>> = {
  // paint-the-town-blue impact story
  HKBJFHsoRNg:
    "BloodPop's remix of Ashnikko's Arcane Season 2 song, from the Extended Edition soundtrack. The original version is not on the channels this archive draws from, so the official remix visualizer stands in for it.",
  // silver-scrapes impact story (Warsongs Topic art track and remix video)
  bSM_sHvLyeE:
    "ProtoShredanoid's Warsongs (2016) remix of Silver Scrapes, the Danny McCarthy track Riot looped through the Season 2 World Championship and now plays before every deciding Game 5. The original release is not on the channels this archive draws from.",
}

// ---------------------------------------------------------------------------
// Internal records

interface Credit {
  name: string
  role: ArtistRole
  /**
   * Role came from the Topic art track (its artist list / "feat." / "X Remix" title) and is never
   * overridden: channel video titles say "ft. X" relative to the label, so a classification's
   * "featured" would wrongly demote a Topic main artist ("Awaken" by Valerie Broussard & Ray Chen).
   */
  readonly explicit: boolean
  /** Role was already set by a (better ranked) video classification. */
  fromClass: boolean
}

interface VideoRecord extends MvCandidate {
  readonly youtubeId: string
  readonly source: string
  readonly title: string
  readonly kind: VideoKind
  readonly role: VideoRole
  readonly durationSeconds: number | null
  readonly uploadDate: string | null
  readonly viewCount: number | null
  readonly mvRank: number | null
  readonly year: number | null
  readonly categories: ReadonlyArray<string>
  readonly game: string | null
  readonly artists: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>
  readonly description: string | null
  readonly isTopic: boolean
  readonly songName: string | null
  readonly topicTrackId: string | null
}

interface TopicCandidate {
  readonly input: TopicTrackInput
  readonly rawTitle: string
  readonly title: string
  readonly norm: string
  readonly dedupeKey: string
  readonly remixer: string | null
  readonly performers: ReadonlyArray<string>
  /** "Remixer:" names of the art-track description. */
  readonly remixers: ReadonlyArray<string>
  readonly credits: ReadonlyArray<Credit>
  readonly performerKeys: string
  readonly creditsDump: boolean
  readonly composers: ReadonlyArray<string>
  readonly labelGames: ReadonlyArray<string>
  readonly album: string | null
  readonly releaseDate: string | null
  readonly releaseYear: number | null
  readonly duration: number | null
  readonly viewCount: number | null
}

interface Draft {
  readonly seq: number
  readonly origin: "topic" | "video"
  readonly topic: ReadonlyArray<TopicCandidate>
  readonly title: string
  readonly rawTitle: string
  readonly norm: string
  readonly album: string | null
  readonly credits: Array<Credit>
  readonly composers: Array<string>
  readonly labelGames: ReadonlyArray<string>
  readonly videos: Map<string, VideoRecord>
  readonly duration: number | null
  /** The Topic artist list is a credits dump; a classification's performer list replaces it. */
  creditsDump: boolean
  impact: ImpactInput | null
}

export interface CatalogStats {
  readonly topicTracks: number
  readonly topicDuplicatesMerged: number
  readonly songsFromTopic: number
  readonly songsFromVideos: number
  readonly videosConsidered: number
  readonly videosLinked: number
  readonly videosUnmatched: ReadonlyArray<string>
  readonly impactMatched: ReadonlyArray<string>
  readonly impactMissing: ReadonlyArray<string>
  /** Song id lock against the previous catalog (see `id-lock.ts`). */
  readonly ids: IdLockReport
}

export interface BuildCatalogOptions {
  readonly now?: string
  /** The catalog being replaced; its song ids are kept for songs that share their media. */
  readonly previous?: Catalog | null
}

export interface BuildCatalogResult {
  readonly catalog: Catalog
  readonly stats: CatalogStats
}

// ---------------------------------------------------------------------------
// Credits

/** Artists named on the description's "Title · Artist · Artist" line (fallback when yt-dlp gave no `artists`). */
const descriptionArtists = (description: string | undefined): ReadonlyArray<string> => {
  const line = description?.split(/\r?\n/).find((l) => l.includes(" · "))
  return line ? line.split(" · ").slice(1).map((s) => s.trim()).filter(Boolean) : []
}

/**
 * Roles of Topic performers: "(feat. X)" → featured, "(X Remix)" → remixer,
 * everyone else primary. Without structured artists (no metadata yet) the
 * names are parsed from the title instead.
 */
export const creditsFromTitle = (rawTitle: string, performers: ReadonlyArray<string>): Array<Credit> => {
  const feat = featuredText(rawTitle).map(nameKey)
  const remix = remixGroups(rawTitle).map(nameKey)
  if (performers.length > 0) {
    return performers.map((name) => {
      const key = nameKey(name)
      const role: ArtistRole =
        key.length > 0 && remix.some((r) => r.includes(key))
          ? "remixer"
          : key.length > 0 && feat.some((f) => f.includes(key))
            ? "featured"
            : "primary"
      return { name, role, explicit: true, fromClass: false }
    })
  }
  const credits: Array<Credit> = []
  for (const text of featuredText(rawTitle))
    for (const name of splitNames(text)) credits.push({ name, role: "featured", explicit: true, fromClass: false })
  for (const group of remixGroups(rawTitle)) {
    const name = group.replace(/\s*\b(?:remix|flip|rework|vip|bootleg)\b.*$/i, "").trim()
    if (name && !isLabel(name)) credits.push({ name, role: "remixer", explicit: true, fromClass: false })
  }
  return credits
}

/**
 * Credits of a Topic art track: `creditsFromTitle`, plus
 * - on a remix album (`REMIX_ALBUMS`) the listed artists are the remixers of
 *   Riot's original and Riot Games Music is the primary artist;
 * - on a remix title ("REMIX RUMBLE (Brazil Remix)") the "Remixer:" lines of the
 *   art-track description name the remixers, who are often not listed as artists.
 */
export const topicCredits = (
  rawTitle: string,
  performers: ReadonlyArray<string>,
  options: { readonly album?: string | null | undefined; readonly remixers?: ReadonlyArray<string> } = {},
): Array<Credit> => {
  if (isRemixAlbum(options.album) && performers.length > 0)
    return [
      { name: RIOT_GAMES_MUSIC.name, role: "primary", explicit: true, fromClass: false },
      ...performers.map((name): Credit => ({ name, role: "remixer", explicit: true, fromClass: false })),
    ]
  const remixers = options.remixers ?? []
  const parsed = creditsFromTitle(rawTitle, performers)
  if (remixGroups(rawTitle).length === 0 || remixers.length === 0) return parsed
  // Without artist metadata the remixer was guessed from the title ("(Brazil Remix)" → "Brazil"):
  // the description's "Remixer:" names replace that guess.
  const credits = performers.length > 0 ? parsed : parsed.filter((c) => c.role !== "remixer")
  for (const name of remixers) {
    if (isLabel(name)) continue
    const existing = credits.find((c) => artistKey(c.name) === artistKey(name))
    if (existing) existing.role = "remixer"
    else credits.push({ name, role: "remixer", explicit: true, fromClass: false })
  }
  return credits
}

const COMPOSER_HEADER = /^([^:]{2,80}):\s*(.+)$/
const UNCLEAN_NAME = /https?:|www\.|[℗©@;|\\/]|\b\d{4}\b|\(|\)/

/**
 * Names credited with a role in a Topic description's credit block:
 * "Composer: Rich Thomson", "Composer Lyricist: Alex Seaver", "Mastering Engineer, Remixer, Producer: X".
 */
export const parseRoleNames = (description: string | null | undefined, role: string): ReadonlyArray<string> => {
  if (!description) return []
  const out: Array<string> = []
  for (const line of description.split(/\r?\n/)) {
    const match = COMPOSER_HEADER.exec(line.trim())
    if (!match) continue
    const roles = match[1]!.split(/[,&]|\s+/).map((s) => s.trim().toLowerCase())
    if (!roles.includes(role)) continue
    const name = match[2]!.trim()
    if (name.length < 2 || name.length > 60 || UNCLEAN_NAME.test(name)) continue
    if (!out.some((n) => nameKey(n) === nameKey(name))) out.push(name)
  }
  return out
}

/** "Composer: Rich Thomson", "Composer Lyricist: Alex Seaver", "Keyboards, Composer, Writer: X" → names. */
export const parseComposers = (description: string | null | undefined): ReadonlyArray<string> =>
  parseRoleNames(description, "composer")

const performerKeySet = (credits: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>): Set<string> =>
  new Set(credits.filter((c) => c.role !== "composer" && !isLabel(c.name)).map((c) => artistKey(c.name)))

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((x) => b.has(x))

const featuredKeys = (credits: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>): ReadonlyArray<string> =>
  credits.filter((c) => c.role === "featured" && !isLabel(c.name)).map((c) => artistKey(c.name))

/** Overlay video-classification credits on a song (only from its primary MV / official audio videos). */
const mergeClassCredits = (draft: Draft, artists: VideoRecord["artists"]): void => {
  const classPerformers = performerKeySet(artists)
  if (draft.creditsDump && classPerformers.size > 0) {
    // Keep only the Topic "artists" the curated classification also names as performers.
    const kept = draft.credits.filter((c) => classPerformers.has(artistKey(c.name)))
    draft.credits.length = 0
    draft.credits.push(...kept)
    draft.creditsDump = false
  }
  for (const artist of artists) {
    if (isLabel(artist.name)) continue
    const key = artistKey(artist.name)
    const existing = draft.credits.find((c) => artistKey(c.name) === key)
    if (artist.role === "composer") {
      if (!existing && !draft.composers.some((n) => artistKey(n) === key)) draft.composers.push(artist.name)
      continue
    }
    if (existing) {
      if (!existing.explicit && !existing.fromClass) {
        existing.role = artist.role
        existing.fromClass = true
      }
    } else {
      draft.credits.push({ name: artist.name, role: artist.role, explicit: false, fromClass: true })
    }
  }
}

/** Final ordered credits: primaries, featured, remixers, then composers; featured become primary when nobody is. */
const finalCredits = (draft: Draft): ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }> => {
  const performers = draft.credits.filter((c) => !isLabel(c.name))
  const hasPrimary = performers.some((c) => c.role === "primary")
  const roleOf = (c: Credit): ArtistRole => (!hasPrimary && c.role === "featured" ? "primary" : c.role)
  const seen = new Set<string>()
  const out: Array<{ name: string; role: ArtistRole }> = []
  for (const role of ["primary", "featured", "remixer"] as const) {
    for (const credit of performers) {
      const key = artistKey(credit.name)
      if (roleOf(credit) !== role || seen.has(key)) continue
      seen.add(key)
      out.push({ name: credit.name, role })
    }
  }
  for (const name of draft.composers) {
    const key = artistKey(name)
    if (seen.has(key) || isLabel(name)) continue
    seen.add(key)
    out.push({ name, role: "composer" })
  }
  if (out.length === 0) out.push({ name: RIOT_GAMES_MUSIC.name, role: "composer" })
  return out
}

// ---------------------------------------------------------------------------
// Topic tracks

const REMIX_WORD = /s*(?:remix|flip|rework|vip|bootleg).*$/i

/** Name inside a "(X Remix)" group, "" for a generic "(Remix)", null when the title is not a remix. */
export const remixerName = (rawTitle: string): string | null => {
  const group = remixGroups(rawTitle)[0]
  return group === undefined ? null : group.replace(REMIX_WORD, "").trim()
}

const topicCandidate = (input: TopicTrackInput): TopicCandidate => {
  const meta = input.meta
  const rawTitle = (meta?.track ?? meta?.title ?? repairMojibake(input.tsvTitle)).trim()
  const names = meta?.artists && meta.artists.length > 0 ? meta.artists : descriptionArtists(meta?.description)
  const performerNames = names.filter((n) => !isLabel(n))
  const performers = performerNames.filter((n, i) => performerNames.findIndex((m) => artistKey(m) === artistKey(n)) === i)
  const remixers = parseRoleNames(meta?.description, "remixer")
  const credits = topicCredits(rawTitle, performers, { album: meta?.album, remixers })
  return {
    input,
    rawTitle,
    title: displayTitle(rawTitle) || rawTitle,
    norm: normalizeTitle(rawTitle),
    // "(Alan Walker Remix)" and "(Remix)" of the same upload compare equal; the names are checked in `topicDuplicates`.
    dedupeKey: normalizeTitle(rawTitle.replace(/([([])[^)]]*(remix|flip|rework|vip|bootleg)[^)]]*([)]])/gi, "$1$2$3")),
    remixer: remixerName(rawTitle),
    performers,
    remixers,
    credits,
    performerKeys: [...performerKeySet(credits)].sort().join(","),
    // Some art tracks list every engineer (with repeats) as an "artist".
    creditsDump: performers.length < performerNames.length,
    composers: parseComposers(meta?.description),
    labelGames: names.flatMap((n) => {
      const game = labelGame(n)
      return game ? [game] : []
    }),
    album: meta?.album ?? null,
    releaseDate: isoDate(meta?.release_date),
    releaseYear: meta?.release_year ?? null,
    duration: meta?.duration ?? input.tsvDuration,
    viewCount: meta?.view_count ?? null,
  }
}

/** Preferred copy of a duplicated art track: has metadata, has audio, most views, earliest release, id. */
const compareCanonical = (a: TopicCandidate, b: TopicCandidate): number =>
  Number(b.input.meta !== null) - Number(a.input.meta !== null) ||
  Number(b.input.audioExists) - Number(a.input.audioExists) ||
  (b.viewCount ?? -1) - (a.viewCount ?? -1) ||
  (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999") ||
  (a.input.id < b.input.id ? -1 : a.input.id > b.input.id ? 1 : 0)

export interface DuplicateCandidate {
  readonly dedupeKey: string
  readonly remixer: string | null
  readonly performerKeys: string
  readonly duration: number | null
}

/**
 * Two art tracks are the same recording when their titles match (ignoring who a
 * "(… Remix)" names), their durations agree within ±3 s and they credit the same
 * performers — or differ only by the remixer one of the titles names
 * ("Legends Never Die (Remix)" by Alan Walker, ATC, Mako ≡ "Legends Never Die
 * (Alan Walker Remix)" by ATC, Mako). Two different named remixers never merge.
 */
export const topicDuplicates = (a: DuplicateCandidate, b: DuplicateCandidate): boolean => {
  if (a.dedupeKey !== b.dedupeKey) return false
  if (a.duration === null || b.duration === null || Math.abs(a.duration - b.duration) > DUPLICATE_TOLERANCE_SECONDS) return false
  if (a.remixer && b.remixer && nameKey(a.remixer) !== nameKey(b.remixer)) return false
  if (a.performerKeys === b.performerKeys) return true
  const ka = new Set(a.performerKeys.split(",").filter(Boolean))
  const kb = new Set(b.performerKeys.split(",").filter(Boolean))
  const named = nameKey(`${a.remixer ?? ""}${b.remixer ?? ""}`)
  const difference = [...[...ka].filter((k) => !kb.has(k)), ...[...kb].filter((k) => !ka.has(k))]
  return named.length > 0 && difference.every((k) => named.includes(k))
}

/** Group Topic tracks into songs (see `topicDuplicates`). Deterministic for any input order. */
export const clusterTopicTracks = <A extends DuplicateCandidate>(tracks: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> => {
  const groups = new Map<string, Array<A>>()
  for (const t of tracks) {
    const list = groups.get(t.dedupeKey) ?? []
    list.push(t)
    groups.set(t.dedupeKey, list)
  }
  const clusters: Array<Array<A>> = []
  for (const key of [...groups.keys()].sort()) {
    const open: Array<Array<A>> = []
    const list = [...groups.get(key)!].sort(
      (a, b) =>
        (a.duration ?? Infinity) - (b.duration ?? Infinity) ||
        a.performerKeys.localeCompare(b.performerKeys) ||
        (a.remixer ?? "").localeCompare(b.remixer ?? ""),
    )
    for (const t of list) {
      const home = open.find((c) => c.every((member) => topicDuplicates(member, t)))
      if (home) home.push(t)
      else open.push([t])
    }
    clusters.push(...open)
  }
  return clusters
}

const topicVideoRecord = (t: TopicCandidate): VideoRecord => ({
  youtubeId: t.input.id,
  source: t.input.source,
  title: t.input.meta?.title ?? t.rawTitle,
  kind: "official_audio",
  role: "audio_source",
  durationSeconds: t.duration,
  uploadDate: isoDate(t.input.meta?.upload_date),
  viewCount: t.viewCount,
  mvRank: null,
  year: t.releaseYear,
  categories: [],
  game: TOPIC_GAMES[t.input.source] ?? null,
  artists: [],
  description: null,
  isTopic: true,
  songName: t.title,
  topicTrackId: t.input.id,
})

// ---------------------------------------------------------------------------
// Channel videos

/** First paragraph of a YouTube description when it reads like prose (no links, not a credit block). */
export const firstParagraph = (description: string | null | undefined): string | null => {
  if (!description) return null
  const paragraph = description.trim().split(/\r?\n\s*\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? ""
  if (paragraph.length < 25 || /https?:\/\/|www\.|^Provided to YouTube/i.test(paragraph)) return null
  if (paragraph.length <= 500) return paragraph
  const cut = paragraph.slice(0, 500)
  const end = cut.lastIndexOf(". ")
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

const videoRecord = (v: VideoClassInput, meta: InfoMeta | undefined): VideoRecord => ({
  youtubeId: v.id,
  source: v.source,
  title: meta?.title ?? repairMojibake(v.title),
  kind: v.kind,
  role: v.role,
  durationSeconds: meta?.duration ?? v.durationSeconds,
  uploadDate: isoDate(meta?.upload_date),
  viewCount: meta?.view_count ?? null,
  mvRank: v.mvRank,
  year: v.year,
  categories: v.categories,
  game: v.game,
  artists: v.artists.filter((a) => !isLabel(a.name)),
  description: firstParagraph(meta?.description),
  isTopic: false,
  songName: v.song,
  topicTrackId: v.topicTrackId,
})

const ROLE_ORDER: Readonly<Record<string, number>> = { primary_mv: 0, audio_source: 1, related: 2, skip: 3 }
const KIND_CATEGORY: Partial<Record<VideoKind, string>> = {
  cinematic: "cinematic",
  login_screen: "login-screen",
  champion_theme: "champion-theme",
  remix: "remix",
  skin_trailer_song: "skin-line",
}

/** Videos whose metadata describes the song itself (not a live cut or making-of). */
const isDefining = (v: VideoRecord): boolean => !v.isTopic && (v.role === "primary_mv" || v.role === "audio_source")

const durationClose = (a: number | null, b: number | null, tolerance: number): boolean =>
  a === null || b === null || Math.abs(a - b) <= tolerance

// ---------------------------------------------------------------------------
// Wiki / Spotify matching

const wikiMatches = (
  draft: Draft,
  year: number | null,
  byId: ReadonlyMap<string, ReadonlyArray<WikiSongInput>>,
  byNorm: ReadonlyMap<string, ReadonlyArray<WikiSongInput>>,
): ReadonlyArray<WikiSongInput> => {
  // Only the art tracks and the song's own MV/official audio: a linked remix or live
  // video has its own wiki entry with other categories.
  const ids = [...draft.topic.map((t) => t.input.id), ...[...draft.videos.values()].filter(isDefining).map((v) => v.youtubeId)]
  const direct = new Set(ids.flatMap((id) => byId.get(id) ?? []))
  if (direct.size > 0) return [...direct]
  const performers = performerKeySet(draft.credits)
  return (byNorm.get(draft.norm) ?? []).filter((w) => {
    const wikiPerformers = new Set(
      w.artists.filter((a) => a.role !== "composer" && !isLabel(a.name)).map((a) => artistKey(a.name)),
    )
    const yearOk = year === null || w.year === null || Math.abs(w.year - year) <= 1
    if (performers.size > 0 && wikiPerformers.size > 0) return intersects(performers, wikiPerformers) && yearOk
    return performers.size === 0 && wikiPerformers.size === 0 && yearOk && w.year !== null && year !== null
  })
}

const spotifyMatches = (
  draft: Draft,
  byNorm: ReadonlyMap<string, ReadonlyArray<SpotifyTrackInput>>,
): ReadonlyArray<SpotifyTrackInput> => {
  const performers = performerKeySet(draft.credits)
  if (performers.size === 0) return []
  return (byNorm.get(draft.norm) ?? []).filter((t) =>
    intersects(performers, new Set(t.artists.filter((a) => !isLabel(a)).map(artistKey))),
  )
}

const groupBy = <A>(items: ReadonlyArray<A>, keys: (a: A) => ReadonlyArray<string>): Map<string, Array<A>> => {
  const out = new Map<string, Array<A>>()
  for (const item of items)
    for (const key of new Set(keys(item))) {
      const list = out.get(key) ?? []
      list.push(item)
      out.set(key, list)
    }
  return out
}

// ---------------------------------------------------------------------------
// Year / release date

/**
 * Year of first release. Dates (Topic release date, upload date of the song's
 * own MV/official audio, Spotify release date) give the earliest release; year-only
 * evidence (video classification, "Season N" compilations)
 * can only move it earlier. The Topic ℗ year is trusted only when it is at
 * least two years earlier — the ℗ line of a 2019 single often says 2018.
 */
export const resolveYear = (evidence: {
  readonly dates: ReadonlyArray<string>
  readonly years: ReadonlyArray<number>
  readonly copyrightYears: ReadonlyArray<number>
}): { readonly year: number | null; readonly releaseDate: string | null } => {
  const earliestDate = [...evidence.dates].sort()[0] ?? null
  const dateYear = yearOf(earliestDate)
  const years = evidence.years.filter((y) => y >= 1990 && y <= 2100)
  const pYear = evidence.copyrightYears.length > 0 ? Math.min(...evidence.copyrightYears) : null
  if (pYear !== null && (dateYear === null || dateYear - pYear >= 2)) years.push(pYear)
  if (dateYear !== null) years.push(dateYear)
  const year = years.length > 0 ? Math.min(...years) : null
  return { year, releaseDate: earliestDate && dateYear === year ? earliestDate : null }
}

// ---------------------------------------------------------------------------
// Impact

const impactScore = (draft: Draft, impact: ImpactInput, year: number | null, audioId: string | null, mvId: string | null) => {
  const performers = performerKeySet(draft.credits)
  const overlap = impact.artists.filter((a) => performers.has(artistKey(a))).length
  const defining = impact.videos.filter((v) => v.role === "primary_mv" || v.role === "audio_source").map((v) => v.youtubeId)
  const anyIds = impact.videos.map((v) => v.youtubeId)
  const ownIds = new Set([...draft.videos.keys(), ...draft.topic.map((t) => t.input.id)])
  return (
    overlap * 3 +
    (defining.some((id) => id === mvId || id === audioId) ? 5 : 0) +
    anyIds.filter((id) => ownIds.has(id)).length +
    (impact.year !== null && year === impact.year ? 2 : 0)
  )
}

// ---------------------------------------------------------------------------
// Build

export const buildCatalog = (inputs: CatalogInputs, options: BuildCatalogOptions = {}): BuildCatalogResult => {
  const gameIds = new Set(inputs.taxonomy.games.map((g) => g.id))
  const categoryIds = new Set(inputs.taxonomy.categories.map((c) => c.id))
  let seq = 0

  // 1. Topic art tracks → songs ----------------------------------------------
  const candidates = inputs.topicTracks.map(topicCandidate)
  const clusters = clusterTopicTracks(candidates)
  const drafts: Array<Draft> = []
  const topicIndex = new Map<string, Draft>()
  const byNorm = new Map<string, Array<Draft>>()
  /** Index a song under a (normalised) title; songs are also found by the song names of their linked videos. */
  const indexTitle = (draft: Draft, norm: string) => {
    const list = byNorm.get(norm) ?? []
    if (!list.includes(draft)) list.push(draft)
    byNorm.set(norm, list)
  }
  const register = (draft: Draft) => {
    drafts.push(draft)
    indexTitle(draft, draft.norm)
  }

  // Deterministic order: by canonical id.
  const sortedClusters = clusters
    .map((c) => [...c].sort(compareCanonical))
    .sort((a, b) => (a[0]!.input.id < b[0]!.input.id ? -1 : 1))
  for (const cluster of sortedClusters) {
    const canonical = cluster[0]!
    // The most specific title of the copies ("… (Alan Walker Remix)" over "… (Remix)"),
    // and every performer any copy credits.
    const named = [...cluster].sort((a, b) => b.rawTitle.length - a.rawTitle.length || compareCanonical(a, b))[0]!
    const performers: Array<string> = []
    for (const name of cluster.flatMap((t) => t.performers))
      if (!performers.some((p) => artistKey(p) === artistKey(name))) performers.push(name)
    const draft: Draft = {
      seq: seq++,
      origin: "topic",
      topic: cluster,
      title: named.title,
      rawTitle: named.rawTitle,
      norm: named.norm,
      album: canonical.album,
      credits:
        cluster.length === 1
          ? canonical.credits.map((c) => ({ ...c }))
          : topicCredits(named.rawTitle, performers, {
              album: canonical.album,
              remixers: [...new Set(cluster.flatMap((t) => t.remixers))],
            }),
      creditsDump: cluster.some((t) => t.creditsDump),
      composers: [...new Set(cluster.flatMap((t) => t.composers))],
      labelGames: [...new Set(cluster.flatMap((t) => t.labelGames))],
      videos: new Map(cluster.map((t) => [t.input.id, topicVideoRecord(t)])),
      duration: canonical.duration,
      impact: null,
    }
    register(draft)
    for (const t of cluster) topicIndex.set(t.input.id, draft)
  }

  // 2. Channel videos → songs ------------------------------------------------
  const videos = inputs.videoClasses
    .filter((v) => v.role !== "skip")
    .map((v) => videoRecord(v, inputs.videoMeta.get(v.id)))
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        (a.mvRank ?? 99) - (b.mvRank ?? 99) ||
        (a.youtubeId < b.youtubeId ? -1 : a.youtubeId > b.youtubeId ? 1 : 0),
    )
  const unmatched: Array<string> = []
  let linked = 0

  const findSong = (video: VideoRecord): Draft | null => {
    if (video.topicTrackId) {
      const draft = topicIndex.get(video.topicTrackId)
      if (draft) return draft
    }
    if (!video.songName) return null
    const performers = performerKeySet(video.artists)
    const scored = (byNorm.get(normalizeTitle(video.songName)) ?? []).flatMap((draft) => {
      const own = performerKeySet(draft.credits)
      // Same title + shared performers is the same song. Without credits on both sides
      // (instrumentals) the durations must agree too — except for related videos
      // (making-ofs, live cuts), whose length says nothing about the song.
      const ok =
        performers.size > 0 && own.size > 0
          ? intersects(performers, own)
          : performers.size === 0 && own.size === 0
            ? video.role === "related" || durationClose(video.durationSeconds, draft.duration, 20)
            : durationClose(video.durationSeconds, draft.duration, 5) &&
              video.durationSeconds !== null &&
              draft.duration !== null
      if (!ok) return []
      // A defining video that features someone the song does not credit is another
      // version ("Ma Meilleure Ennemie (ft. Coldplay)", the Tori Kelly duet of "You & Me Makes Us").
      if (isDefining(video) && featuredKeys(video.artists).some((k) => !own.has(k))) return []
      const distance =
        video.durationSeconds !== null && draft.duration !== null ? Math.abs(video.durationSeconds - draft.duration) : 999
      return [{ draft, distance }]
    })
    scored.sort((a, b) => a.distance - b.distance || a.draft.seq - b.draft.seq)
    return scored[0]?.draft ?? null
  }

  for (const video of videos) {
    let draft = findSong(video)
    if (!draft && video.songName && (video.role === "audio_source" || (video.role === "primary_mv" && isMvEligible(video)))) {
      draft = {
        seq: seq++,
        origin: "video",
        topic: [],
        // Keep an explicit "(ft. X)" in the title of a featured version so it reads differently.
        title:
          featuredText(video.songName).length > 0 && (byNorm.get(normalizeTitle(video.songName))?.length ?? 0) > 0
            ? video.songName.trim()
            : displayTitle(video.songName) || video.songName,
        rawTitle: video.songName,
        norm: normalizeTitle(video.songName),
        album: null,
        // Credits come from the structured classification (mergeClassCredits below).
        credits: [],
        composers: [],
        labelGames: [],
        videos: new Map(),
        duration: video.durationSeconds,
        creditsDump: false,
        impact: null,
      }
      register(draft)
    }
    if (!draft) {
      unmatched.push(`${video.youtubeId} (${video.role}/${video.kind}: ${video.songName ?? video.title})`)
      continue
    }
    linked++
    draft.videos.set(video.youtubeId, video)
    if (video.songName && isDefining(video)) indexTitle(draft, normalizeTitle(video.songName))
    if (isDefining(video)) mergeClassCredits(draft, video.artists)
  }

  // 3. Per-song resolution ---------------------------------------------------
  const wikiById = groupBy(inputs.wikiSongs, (w) => w.youtubeIds)
  const wikiByNorm = groupBy(inputs.wikiSongs, (w) => [normalizeTitle(w.title)])
  const spotifyByNorm = groupBy(inputs.spotifyTracks, (t) => [normalizeTitle(t.title)])
  const wikiAlbumGames = new Map(
    inputs.wikiAlbums.flatMap((a) => (a.game ? [[normalizeTitle(a.title), a.game] as const] : [])),
  )
  const extraChampions = new Set(inputs.wikiSongs.flatMap((w) => w.champions.map((c) => c.toLowerCase())))

  interface Resolved {
    readonly draft: Draft
    readonly credits: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>
    readonly gameId: string
    readonly categories: ReadonlyArray<string>
    readonly year: number | null
    readonly releaseDate: string | null
    readonly album: string | null
    readonly audio: { readonly youtubeId: string; readonly kind: AudioKind } | null
    readonly musicVideo: VideoRecord | null
    readonly videos: ReadonlyArray<VideoRecord>
    readonly viewCount: number | null
    readonly description: string | null
  }

  const resolve = (draft: Draft): Resolved => {
    const credits = finalCredits(draft)
    const all = [...draft.videos.values()]
    const defining = all.filter(isDefining)
    const spotify = spotifyMatches(draft, spotifyByNorm)

    // Year / release date
    const seasonYears = [draft.rawTitle, draft.album, ...draft.topic.map((t) => t.album)].flatMap((text) => {
      const y = seasonYear(text)
      return y === null ? [] : [y]
    })
    const { year, releaseDate } = resolveYear({
      dates: [
        ...draft.topic.flatMap((t) => (t.releaseDate ? [t.releaseDate] : [])),
        ...defining.flatMap((v) => (v.uploadDate ? [v.uploadDate] : [])),
        ...spotify.flatMap((t) => {
          const d = isoDate(t.releaseDate)
          return d ? [d] : []
        }),
      ],
      years: [
        ...seasonYears,
        ...defining.flatMap((v) => (v.year !== null ? [v.year] : [])),
      ],
      copyrightYears: draft.topic.flatMap((t) => (t.releaseYear !== null ? [t.releaseYear] : [])),
    })

    const wiki = wikiMatches(draft, year, wikiById, wikiByNorm)

    // Game
    const albumKey = draft.album ? normalizeTitle(draft.album) : null
    const majority = (games: ReadonlyArray<string | null>): string | null => {
      const counts = new Map<string, number>()
      for (const g of games) if (g && gameIds.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }
    const topicSource = draft.topic[0]?.input.source ?? null
    const candidatesGames: ReadonlyArray<string | null> = [
      gameFromText(draft.album),
      albumKey ? (wikiAlbumGames.get(albumKey) ?? null) : null,
      gameFromText(draft.rawTitle),
      draft.labelGames[0] ?? null,
      topicSource && topicSource !== SHARED_TOPIC ? (TOPIC_GAMES[topicSource] ?? null) : null,
      majority(defining.map((v) => v.game)),
      majority(wiki.map((w) => w.game)),
      topicSource ? (TOPIC_GAMES[topicSource] ?? null) : null,
      majority(all.map((v) => CHANNEL_GAMES[v.source] ?? null)),
    ]
    const gameId = candidatesGames.find((g): g is string => g !== null && gameIds.has(g)) ?? FALLBACK_GAME

    // Categories
    const categories = new Set<string>()
    for (const v of defining) {
      for (const c of v.categories) categories.add(c)
      const fromKind = KIND_CATEGORY[v.kind]
      if (fromKind) categories.add(fromKind)
    }
    for (const w of wiki) for (const c of w.categories) categories.add(c)
    const heuristics = heuristicCategories({
      title: draft.rawTitle,
      album: draft.album,
      isVirtualGroup: credits.some((c) => c.role !== "composer" && isVirtualGroup(c.name)),
      hasRemixer: credits.some((c) => c.role === "remixer"),
      gameId,
      extraChampions,
    })
    for (const c of heuristics) categories.add(c)
    if (gameId === "arcane") categories.add("arcane")
    splitWorlds(categories, draft.rawTitle)
    const known = [...categories].filter((c) => categoryIds.has(c))
    const finalCategories = sortCategories(known.length > 0 ? known : [FALLBACK_CATEGORY])

    // Media
    const musicVideo = pickMusicVideo(all.filter((v) => !v.isTopic))
    const officialAudio = defining
      .filter((v) => v.role === "audio_source" && v.kind === "official_audio")
      .sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1) || (a.youtubeId < b.youtubeId ? -1 : 1))[0]
    const topicWithAudio = draft.topic.find((t) => t.input.audioExists)
    const audio: Resolved["audio"] = topicWithAudio
      ? { youtubeId: topicWithAudio.input.id, kind: "topic" }
      : officialAudio
        ? { youtubeId: officialAudio.youtubeId, kind: "official_audio" }
        : draft.topic[0]
          ? { youtubeId: draft.topic[0].input.id, kind: "topic" }
          : musicVideo
            ? { youtubeId: musicVideo.youtubeId, kind: "music_video" }
            : null

    // Album: Topic album, else the wiki's or Spotify's release name.
    const album =
      draft.album ??
      wiki.find((w) => w.album)?.album ??
      spotify.find((t) => t.releaseType === "album")?.releaseName ??
      spotify[0]?.releaseName ??
      null

    const views = all.flatMap((v) => (v.viewCount !== null ? [v.viewCount] : []))
    const ordered = [...all].sort((a, b) => {
      const rank = (v: VideoRecord) => (v === musicVideo ? -1 : (ROLE_ORDER[v.role] ?? 9) * 2 + (v.isTopic ? 1 : 0))
      return (
        rank(a) - rank(b) ||
        (a.role === "primary_mv" && b.role === "primary_mv" ? compareMvCandidates(a, b) : 0) ||
        (a.uploadDate ?? "9999").localeCompare(b.uploadDate ?? "9999") ||
        (a.youtubeId < b.youtubeId ? -1 : a.youtubeId > b.youtubeId ? 1 : 0)
      )
    })

    return {
      draft,
      credits,
      gameId,
      categories: finalCategories,
      year,
      releaseDate,
      album,
      audio,
      musicVideo,
      videos: ordered,
      viewCount: views.length > 0 ? Math.max(...views) : null,
      description:
        [audio?.youtubeId, musicVideo?.youtubeId].map((id) => (id ? SONG_NOTES[id] : undefined)).find(Boolean) ??
        musicVideo?.description ??
        officialAudio?.description ??
        null,
    }
  }

  // Impact research is matched on the resolved songs (title, credits, MV / audio ids, year).
  const impacts = new Map<string, ImpactInput>()
  for (const impact of [...DEFAULT_IMPACT, ...inputs.impact]) impacts.set(impact.slug, impact)
  const resolved = drafts.map(resolve)
  const impactMatched: Array<string> = []
  const impactMissing: Array<string> = []
  for (const impact of [...impacts.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const norm = normalizeTitle(impact.song)
    const ids = new Set(impact.videos.filter((v) => v.role === "primary_mv" || v.role === "audio_source").map((v) => v.youtubeId))
    let pool = resolved.filter((r) => r.draft.norm === norm && r.draft.impact === null)
    if (pool.length === 0) pool = resolved.filter((r) => r.draft.impact === null && [...r.draft.videos.keys()].some((id) => ids.has(id)))
    const best = pool
      .map((r) => ({ r, score: impactScore(r.draft, impact, r.year, r.audio?.youtubeId ?? null, r.musicVideo?.youtubeId ?? null) }))
      .sort((a, b) => b.score - a.score || (b.r.viewCount ?? -1) - (a.r.viewCount ?? -1) || a.r.draft.seq - b.r.draft.seq)[0]
    if (best && (best.score > 0 || pool.length === 1)) {
      best.r.draft.impact = impact
      impactMatched.push(impact.slug)
    } else {
      impactMissing.push(impact.slug)
    }
  }

  // 4. Ids -------------------------------------------------------------------
  const importance = [...resolved].sort(
    (a, b) =>
      Number(b.draft.impact !== null) - Number(a.draft.impact !== null) ||
      Number(b.musicVideo !== null) - Number(a.musicVideo !== null) ||
      Number(b.draft.origin === "topic") - Number(a.draft.origin === "topic") ||
      (b.viewCount ?? -1) - (a.viewCount ?? -1) ||
      (a.year ?? 9999) - (b.year ?? 9999) ||
      a.draft.seq - b.draft.seq,
  )
  // Songs that share media with a song of the previous catalog keep its id; the
  // rest get fresh slugs that avoid every previous id.
  const lockCandidates: ReadonlyArray<LockCandidate> = importance.map((r) => ({
    key: r.draft.seq,
    audioId: r.audio?.youtubeId ?? null,
    topicIds: r.draft.topic.map((t) => t.input.id),
    musicVideoId: r.musicVideo?.youtubeId ?? null,
  }))
  const lock = lockSongIds(options.previous, lockCandidates)
  const usedIds = new Set<string>([...lock.reserved, ...lock.locked.values()])
  const songIds = new Map<Draft, string>()
  for (const r of importance) {
    const lockedId = lock.locked.get(r.draft.seq)
    if (lockedId) {
      songIds.set(r.draft, lockedId)
      continue
    }
    const base = songSlug(r.draft.title)
    const lead = r.credits.find((c) => c.role !== "composer") ?? r.credits[0]
    const artistPart = lead && lead.name !== RIOT_GAMES_MUSIC.name ? slugOr(lead.name, "artist") : null
    // A featured version keeps "(ft. X)" in its title: disambiguate with X first.
    const featured = featuredText(r.draft.title).flatMap(splitNames)[0]
    const options = [
      base,
      featured ? `${base}-${slugOr(featured, "ft")}` : null,
      artistPart ? `${base}-${artistPart}` : null,
      r.year !== null ? `${base}-${r.year}` : null,
      artistPart && r.year !== null ? `${base}-${artistPart}-${r.year}` : null,
    ].filter((x): x is string => x !== null)
    let id = options.find((o) => !usedIds.has(o))
    if (!id) {
      let n = 2
      while (usedIds.has(`${base}-${n}`)) n++
      id = `${base}-${n}`
    }
    usedIds.add(id)
    songIds.set(r.draft, id)
  }
  const ids = idLockReport(
    options.previous,
    lockCandidates,
    lock,
    new Map([...songIds.entries()].map(([draft, id]) => [draft.seq, id] as const)),
  )

  // 5. Artists ---------------------------------------------------------------
  const registry = new ArtistRegistry()
  for (const r of resolved) for (const c of r.credits) registry.add(c.name, c.role)

  const toVideo = (v: VideoRecord): CatalogVideo => ({
    youtubeId: v.youtubeId,
    source: v.source,
    title: v.title,
    kind: v.kind,
    role: v.role,
    durationSeconds: v.durationSeconds,
    uploadDate: v.uploadDate,
    viewCount: v.viewCount,
  })

  const artistById = new Map(registry.all().map((a) => [a.id, a]))
  const songs: Array<CatalogSong> = resolved.map((r) => {
    const artists: Array<{ id: string; role: ArtistRole }> = []
    for (const credit of r.credits) {
      const artist = registry.get(artistKey(credit.name))
      if (!artists.some((a) => a.id === artist.id)) artists.push({ id: artist.id, role: credit.role })
    }
    const displayCredits = artists.map((a) => ({ name: artistById.get(a.id)!.name, role: a.role }))
    const coverYoutubeId = r.draft.topic[0]?.input.id ?? r.musicVideo?.youtubeId ?? r.audio?.youtubeId ?? null
    return {
      id: songIds.get(r.draft)!,
      title: r.draft.title,
      displayArtist: formatDisplayArtist(displayCredits),
      artists,
      gameId: r.gameId,
      primaryCategoryId: primaryCategory(r.categories),
      categoryIds: r.categories,
      album: r.album,
      year: r.year,
      releaseDate: r.releaseDate,
      audio: r.audio,
      musicVideo: r.musicVideo ? { youtubeId: r.musicVideo.youtubeId, kind: r.musicVideo.kind } : null,
      videos: r.videos.map(toVideo),
      coverYoutubeId,
      viewCount: r.viewCount,
      isImpact: r.draft.impact !== null,
      impactSlug: r.draft.impact?.slug ?? null,
      description: r.description,
    }
  })
  songs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const referenced = new Set(songs.flatMap((s) => s.artists.map((a) => a.id)))
  const artists = registry.all().filter((a) => referenced.has(a.id))

  return {
    catalog: { generatedAt: options.now ?? new Date().toISOString(), songs, artists },
    stats: {
      topicTracks: inputs.topicTracks.length,
      topicDuplicatesMerged: inputs.topicTracks.length - sortedClusters.length,
      songsFromTopic: drafts.filter((d) => d.origin === "topic").length,
      songsFromVideos: drafts.filter((d) => d.origin === "video").length,
      videosConsidered: videos.length,
      videosLinked: linked,
      videosUnmatched: unmatched,
      impactMatched,
      impactMissing,
      ids,
    },
  }
}
