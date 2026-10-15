import { mediaUrl, youtubeThumbnail, youtubeUrl } from "@workspace/db/domain/media"
import {
  isOnDisc,
  type TimelineArtist,
  type TimelineData,
  type TimelineDatePrecision,
  type TimelineDisc,
  type TimelineEntryDetail,
  type TimelineSource,
  type TimelineTag,
  type TimelineVideo,
} from "@workspace/db/domain/timeline"
import type { VideoKind } from "@workspace/db/domain/types"
import { formatDisplayArtist, nameKey, normalizeTitle } from "../catalog/normalize.ts"
import { isWorldsTheme } from "../catalog/rules.ts"
import type { CatalogSong, CatalogVideo } from "../catalog/types.ts"
import type { AssociationInput, Sourced, TimelineInputs } from "./inputs.ts"
import type { ExtraEntry, ResearchEntry } from "./types.ts"

/**
 * The pure merge behind `npm run pipeline -- timeline`:
 *
 *   data/catalog.json songs  ─┐
 *   timeline extras (x-…)    ─┼─ research (date, usedFor, background, cover, sources)
 *                             ├─ associations (game, tags, music video, audio)
 *                             └─ local media (audio, video, covers, palettes, durations)
 *                                  → TimelineData (sorted by date, then title) + a report
 *
 * No IO: every file lookup goes through `inputs.media`, so it is unit tested
 * on in-memory fixtures (packages/pipeline/test/timeline.test.ts).
 */

// ---------------------------------------------------------------------------
// Report

export type DateSource = "research" | "release-date" | "year" | "extra" | "upload-date"

export interface TimelineReport {
  readonly generatedAt: string
  readonly totals: {
    readonly entries: number
    readonly archive: number
    readonly extras: number
    readonly withResearch: number
    readonly withAssociation: number
    readonly withBackground: number
    readonly withAudio: number
    readonly withVideo: number
    readonly withLocalVideo: number
    readonly withCover: number
    readonly withLocalCover: number
    readonly withPalette: number
    readonly withDuration: number
  }
  readonly inputs: {
    readonly research: { readonly files: number; readonly entries: number; readonly used: number }
    readonly extras: { readonly files: number; readonly entries: number; readonly kept: number }
    readonly associations: { readonly files: number; readonly entries: number; readonly used: number }
  }
  readonly byGame: Readonly<Record<string, number>>
  readonly byDisc: Readonly<Record<string, number>>
  readonly byYear: Readonly<Record<string, number>>
  readonly byDatePrecision: Readonly<Record<TimelineDatePrecision, number>>
  readonly byDateSource: Readonly<Record<string, number>>
  /** Ids of entries without a background. */
  readonly withoutBackground: ReadonlyArray<string>
  /** Research / association entries whose songId matches no catalog song or kept extra. */
  readonly unknownIds: ReadonlyArray<{
    readonly kind: "research" | "association"
    readonly file: string
    readonly songId: string
  }>
  readonly unknownTags: ReadonlyArray<{ readonly file: string | null; readonly songId: string; readonly tag: string }>
  readonly unknownGames: ReadonlyArray<{
    readonly file: string | null
    readonly songId: string
    readonly gameId: string
  }>
  readonly invalidDates: ReadonlyArray<{ readonly songId: string; readonly source: DateSource; readonly value: string }>
  /** Extras that duplicate a catalog song (dropped) or another extra (kept, worth a look). */
  readonly duplicates: ReadonlyArray<{
    readonly file: string
    readonly id: string
    readonly title: string
    readonly gameId: string
    readonly duplicateOf: string
    readonly dropped: boolean
  }>
  /** The same id in several curated entries: the first one (file order) wins. */
  readonly conflicts: ReadonlyArray<{
    readonly kind: "research" | "association" | "extra"
    readonly id: string
    readonly kept: string
    readonly ignored: string
    readonly identical: boolean
  }>
  readonly droppedExtras: ReadonlyArray<{ readonly file: string; readonly id: string; readonly reason: string }>
  /** Curated video / audio ids that video-classes marks `skip` (deliberate exclusions). */
  readonly excludedVideos: ReadonlyArray<{
    readonly songId: string
    readonly youtubeId: string
    readonly field: "musicVideo" | "audio"
    readonly reason: string
  }>
  readonly taxonomy: {
    readonly categoriesWithoutTag: ReadonlyArray<string>
    readonly unknownDiscReferences: ReadonlyArray<{
      readonly disc: string
      readonly kind: "game" | "tag"
      readonly id: string
    }>
  }
  readonly problems: ReadonlyArray<string>
}

export interface TimelineBuild {
  readonly data: TimelineData
  readonly report: TimelineReport
}

// ---------------------------------------------------------------------------
// Dates

export interface ParsedDate {
  readonly date: string
  readonly precision: TimelineDatePrecision
  readonly year: number
  readonly month: number
}

const MIN_YEAR = 1990
const MAX_YEAR = 2100

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()
const pad = (n: number) => String(n).padStart(2, "0")

/**
 * `yyyy-mm-dd` (also `yyyymmdd` / an ISO timestamp) → day, `yyyy-mm` → month,
 * `yyyy` → year; imprecise dates are padded to the 1st. Impossible dates → null.
 */
export const parseTimelineDate = (value: string | number | null | undefined): ParsedDate | null => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(text) ??
    /^(\d{4})-(\d{2})$/.exec(text) ??
    /^(\d{4})$/.exec(text)
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] === undefined ? null : Number(match[2])
  const day = match[3] === undefined ? null : Number(match[3])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  if (month !== null && (month < 1 || month > 12)) return null
  if (month !== null && day !== null && (day < 1 || day > daysIn(year, month))) return null
  const precision: TimelineDatePrecision = day !== null ? "day" : month !== null ? "month" : "year"
  return { date: `${year}-${pad(month ?? 1)}-${pad(day ?? 1)}`, precision, year, month: month ?? 1 }
}

// ---------------------------------------------------------------------------
// Tags

export interface TagContext {
  readonly title: string
  readonly album: string | null
  readonly artistNames: ReadonlyArray<string>
  /** Catalog categories (plus an extra's own tags). */
  readonly categoryIds: ReadonlyArray<string>
}

/** Artists that are one of Riot's virtual groups → their tag (each also adds `virtual-group`). */
const GROUP_ARTISTS: ReadonlyMap<string, string> = new Map([
  [nameKey("K/DA"), "k-da"],
  [nameKey("True Damage"), "true-damage"],
  [nameKey("Pentakill"), "pentakill"],
  [nameKey("HEARTSTEEL"), "heartsteel"],
  [nameKey("Seraphine"), "seraphine"],
])

/** Matched against the title and the album separately. */
const TEXT_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly tags: ReadonlyArray<string> }> = [
  { pattern: /^Sessions:/i, tags: ["sessions"] },
  { pattern: /The Music of League of Legends/i, tags: ["music-of-league"] },
  { pattern: /Warsongs/i, tags: ["warsongs"] },
  { pattern: /remix rumble/i, tags: ["remix-rumble"] },
  { pattern: /star guardian/i, tags: ["star-guardian", "skin-line"] },
  { pattern: /spirit blossom/i, tags: ["spirit-blossom", "skin-line"] },
  { pattern: /soul fighter/i, tags: ["soul-fighter", "skin-line"] },
  { pattern: /\ball[- ]stars?\b/i, tags: ["all-stars"] },
  { pattern: /\bMSI\b|mid-season invitational/i, tags: ["msi"] },
]

const WORLDS_THEME_TEXT = /world championship theme/i
/** "Aurora, the Witch Between Worlds" is a champion theme, not a Worlds song. */
const WORLDS_TEXT = /(?<!between )\bworlds\b|world championship/i

const dedupe = <A>(items: Iterable<A>): Array<A> => [...new Set(items)]

/** Catalog categories plus the tags implied by the credits, the title and the album. */
export const deriveTags = (ctx: TagContext): ReadonlyArray<string> => {
  const tags = [...ctx.categoryIds]
  for (const name of ctx.artistNames) {
    const tag = GROUP_ARTISTS.get(nameKey(name))
    if (tag) tags.push(tag, "virtual-group")
  }
  const texts = [ctx.title, ctx.album ?? ""].filter((t) => t.length > 0)
  for (const rule of TEXT_RULES) if (texts.some((t) => rule.pattern.test(t))) tags.push(...rule.tags)
  // A song is a Worlds anthem or a Worlds orchestral theme, never both; the catalog's choice stands.
  if (!ctx.categoryIds.includes("worlds") && !ctx.categoryIds.includes("worlds-theme")) {
    if (texts.some((t) => WORLDS_THEME_TEXT.test(t))) tags.push("worlds-theme")
    else if (texts.some((t) => WORLDS_TEXT.test(t))) tags.push("worlds")
  }
  return dedupe(tags)
}

// ---------------------------------------------------------------------------
// Text fallbacks

const MAX_USED_FOR = 60
const MAX_BACKGROUND = 320

const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`
}

/** The first ≤ 2 sentences (≤ 320 chars) of a catalog description, without links or hashtags. */
export const backgroundFromDescription = (description: string | null): string | null => {
  if (!description) return null
  const text = description
    // A link's trailing punctuation still ends the sentence.
    .replace(/https?:\/\/\S*[^\s.,;:!?)\]'"”’]/g, " ")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
  if (text.length < 3) return null
  // A sentence ends at . ! ? (plus closing quotes) followed by a capital or a digit,
  // except after common abbreviations ("8:00 a.m. PT", "ft. Madison Beer").
  const sentences = text
    .split(
      /(?<=[.!?]["'”’)]*)(?<!\b(?:a\.m|p\.m|e\.g|i\.e|vs|ft|feat|Mr|Mrs|Ms|Dr|St|Vol|No|Jr|Sr)\.)\s+(?=[\p{Lu}\p{N}"'“‘(])/u,
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  let out = ""
  for (const sentence of sentences.slice(0, 2)) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > MAX_BACKGROUND) break
    out = next
  }
  return out || truncate(sentences[0]!, MAX_BACKGROUND)
}

export interface UsedForContext {
  readonly title: string
  readonly album: string | null
  readonly gameId: string
  readonly primaryCategoryId: string
  readonly tags: ReadonlyArray<string>
  readonly gameNames: ReadonlyMap<string, string>
  readonly tagNames: ReadonlyMap<string, string>
}

const GROUP_TAGS = ["k-da", "true-damage", "pentakill", "heartsteel", "seraphine"]
const SERIES_TAGS = ["star-guardian", "spirit-blossom", "soul-fighter"]

/** A generic "what it was for" label from the primary category and the album. */
export const genericUsedFor = (ctx: UsedForContext): string => {
  const album =
    ctx.album && normalizeTitle(ctx.album) !== normalizeTitle(ctx.title) && normalizeTitle(ctx.album).length > 0
      ? ctx.album
      : null
  const fromAlbum = album ? `Track from ${album}` : null
  const tagName = (ids: ReadonlyArray<string>) => {
    const id = ids.find((t) => ctx.tags.includes(t))
    return id ? (ctx.tagNames.get(id) ?? null) : null
  }
  const game = ctx.gameNames.get(ctx.gameId) ?? null
  const label = (() => {
    switch (ctx.primaryCategoryId) {
      case "worlds":
        return "Worlds anthem"
      case "worlds-theme":
        return "Worlds orchestral theme"
      case "msi":
        return "MSI theme"
      case "valorant-champions":
        return "VALORANT esports anthem"
      case "esports":
        return "Esports music"
      case "champion-theme":
        return ctx.gameId === "valorant" ? "Agent theme" : ctx.gameId === "2xko" ? "Fighter theme" : "Champion theme"
      case "cinematic":
        return "Cinematic music"
      case "login-screen":
        return "Login screen"
      case "animated-short":
        return "Animated short music"
      case "skin-line": {
        const series = tagName(SERIES_TAGS)
        return series ? `${series} music` : (fromAlbum ?? "Skin line & event music")
      }
      case "virtual-group": {
        const group = tagName(GROUP_TAGS)
        return group ? `${group} song` : "Virtual group song"
      }
      case "arcane":
        return fromAlbum ?? "Arcane soundtrack"
      case "remix":
        return "Official remix"
      default:
        return fromAlbum ?? (game ? `${game} soundtrack` : "Game soundtrack")
    }
  })()
  return truncate(label, MAX_USED_FOR)
}

// ---------------------------------------------------------------------------
// Drafts: catalog songs and extras before research / associations / media

interface Draft {
  readonly id: string
  readonly inArchive: boolean
  /** Curated file of an extra (for reports). */
  readonly file: string | null
  readonly title: string
  readonly displayArtist: string
  readonly artists: ReadonlyArray<TimelineArtist>
  readonly gameId: string
  readonly categoryIds: ReadonlyArray<string>
  /** An extra's own timeline tags. */
  readonly ownTags: ReadonlyArray<string>
  readonly primaryCategoryId: string | null
  readonly album: string | null
  readonly dates: ReadonlyArray<{ readonly value: string | null; readonly source: DateSource }>
  readonly usedFor: string | null
  readonly background: string | null
  readonly coverYoutubeId: string | null
  readonly coverUrl: string | null
  readonly spotifyUrl: string | null
  readonly audioYoutubeId: string | null
  readonly musicVideo: {
    readonly youtubeId: string
    readonly kind: VideoKind | null
    readonly title: string | null
  } | null
  readonly videos: ReadonlyArray<CatalogVideo>
  readonly viewCount: number | null
  readonly isImpact: boolean
  readonly sources: ReadonlyArray<TimelineSource>
}

const catalogDraft = (song: CatalogSong, artistNames: ReadonlyMap<string, string>): Draft => {
  const seen = new Set<string>()
  const artists = song.artists.flatMap((a) => {
    const key = `${a.id}|${a.role}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ name: artistNames.get(a.id) ?? a.id, role: a.role, id: artistNames.has(a.id) ? a.id : null }]
  })
  return {
    id: song.id,
    inArchive: true,
    file: null,
    title: song.title,
    displayArtist: song.displayArtist,
    artists,
    gameId: song.gameId,
    categoryIds: song.categoryIds,
    ownTags: [],
    primaryCategoryId: song.primaryCategoryId,
    album: song.album,
    dates: [
      { value: song.releaseDate, source: "release-date" },
      { value: song.year === null ? null : String(song.year), source: "year" },
    ],
    usedFor: null,
    background: backgroundFromDescription(song.description),
    coverYoutubeId: song.coverYoutubeId,
    coverUrl: null,
    spotifyUrl: null,
    audioYoutubeId: song.audio?.youtubeId ?? null,
    musicVideo: song.musicVideo
      ? { youtubeId: song.musicVideo.youtubeId, kind: song.musicVideo.kind, title: null }
      : null,
    videos: song.videos,
    viewCount: song.viewCount,
    isImpact: song.isImpact,
    sources: [],
  }
}

const extraDraft = (file: string, extra: ExtraEntry, artistIds: ReadonlyMap<string, string>): Draft => {
  const artists = extra.artists.map((a) => ({ name: a.name, role: a.role, id: artistIds.get(nameKey(a.name)) ?? null }))
  return {
    id: extra.id,
    inArchive: false,
    file,
    title: extra.title,
    displayArtist: formatDisplayArtist(artists),
    artists,
    gameId: extra.gameId,
    categoryIds: extra.categoryIds,
    ownTags: extra.tags,
    primaryCategoryId: extra.categoryIds[0] ?? null,
    album: extra.album,
    dates: [{ value: extra.date, source: "extra" }],
    usedFor: extra.usedFor,
    background: extra.background,
    coverYoutubeId: null,
    coverUrl: extra.coverUrl,
    spotifyUrl: extra.spotifyUrl,
    audioYoutubeId: extra.audioYoutubeId,
    musicVideo: extra.musicVideoYoutubeId
      ? { youtubeId: extra.musicVideoYoutubeId, kind: extra.musicVideoKind, title: extra.musicVideoTitle ?? null }
      : null,
    videos: [],
    viewCount: null,
    isImpact: false,
    sources: extra.sources,
  }
}

// ---------------------------------------------------------------------------
// Build

/** Titles the user removed from the archive on purpose; never brought back as extras. */
const REMOVED_TITLES: ReadonlySet<string> = new Set([normalizeTitle("You Are My Legend")])

const countInto = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

const sortedRecord = (counts: Record<string, number>, byKey = false): Record<string, number> =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => (byKey ? a[0].localeCompare(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0]))),
  )

const roundDuration = (seconds: number | null): number | null =>
  seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : null

export const buildTimeline = (inputs: TimelineInputs): TimelineBuild => {
  const { catalog, taxonomy, media } = inputs
  const problems: Array<string> = [...inputs.problems]
  const unknownIds: Array<TimelineReport["unknownIds"][number]> = []
  const unknownTags: Array<TimelineReport["unknownTags"][number]> = []
  const unknownGames: Array<TimelineReport["unknownGames"][number]> = []
  const invalidDates: Array<TimelineReport["invalidDates"][number]> = []
  const duplicates: Array<TimelineReport["duplicates"][number]> = []
  const conflicts: Array<TimelineReport["conflicts"][number]> = []
  const droppedExtras: Array<TimelineReport["droppedExtras"][number]> = []
  const excludedVideos: Array<TimelineReport["excludedVideos"][number]> = []

  // --- vocabularies
  const gameIds = new Set(taxonomy.games.map((g) => g.id))
  const gameNames = new Map(taxonomy.games.map((g) => [g.id, g.name]))
  const categoryIds = new Set(taxonomy.categories.map((c) => c.id))
  const tags: ReadonlyArray<TimelineTag> = inputs.timelineTaxonomy
    ? dedupeBy(inputs.timelineTaxonomy.tags, (t) => t.id).map((t) => ({ ...t }))
    : taxonomy.categories.map((c) => ({
        id: c.id,
        name: c.name,
        kind: "format",
        description: c.description,
        color: "#888888",
      }))
  const tagNames = new Map(tags.map((t) => [t.id, t.name]))
  const knownTags = new Set([...tags.map((t) => t.id), ...categoryIds])
  const categoriesWithoutTag = taxonomy.categories.map((c) => c.id).filter((id) => !tagNames.has(id))
  const artistNames = new Map(catalog.artists.map((a) => [a.id, a.name]))
  const artistIds = new Map(catalog.artists.map((a) => [nameKey(a.name), a.id]))

  // --- curated entries, first one wins
  const firstBy = <A>(
    items: ReadonlyArray<Sourced<A>>,
    key: (a: A) => string,
    kind: "research" | "association" | "extra",
  ) => {
    const out = new Map<string, Sourced<A>>()
    for (const item of items) {
      const id = key(item.entry)
      const kept = out.get(id)
      if (!kept) {
        out.set(id, item)
        continue
      }
      conflicts.push({
        kind,
        id,
        kept: kept.file,
        ignored: item.file,
        identical: JSON.stringify(kept.entry) === JSON.stringify(item.entry),
      })
    }
    return out
  }
  const research = firstBy<ResearchEntry>(inputs.research, (r) => r.songId, "research")
  const associations = firstBy<AssociationInput>(inputs.associations, (a) => a.songId, "association")

  // --- extras
  const catalogKeys = new Map<string, string>()
  for (const song of catalog.songs) {
    const key = `${song.gameId}|${normalizeTitle(song.title)}`
    if (!catalogKeys.has(key)) catalogKeys.set(key, song.id)
  }
  const catalogIds = new Set(catalog.songs.map((s) => s.id))
  const keptExtras: Array<Draft> = []
  const extraKeys = new Map<string, string>()
  const seenExtraIds = new Map<string, string>()
  for (const { file, entry } of inputs.extras) {
    const drop = (reason: string) => droppedExtras.push({ file, id: entry.id, reason })
    if (entry.verified === false) {
      drop("verified: false")
      continue
    }
    if (!/^x-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      drop(`id must be "x-" + a kebab-case slug`)
      continue
    }
    if (catalogIds.has(entry.id)) {
      drop("id is already a catalog song id")
      continue
    }
    const keptFile = seenExtraIds.get(entry.id)
    if (keptFile !== undefined) {
      conflicts.push({ kind: "extra", id: entry.id, kept: keptFile, ignored: file, identical: false })
      continue
    }
    seenExtraIds.set(entry.id, file)
    if (!gameIds.has(entry.gameId)) {
      unknownGames.push({ file, songId: entry.id, gameId: entry.gameId })
      drop(`unknown game ${JSON.stringify(entry.gameId)}`)
      continue
    }
    const titleKey = normalizeTitle(entry.title)
    if (REMOVED_TITLES.has(titleKey)) {
      drop("removed from the archive on purpose")
      continue
    }
    const key = `${entry.gameId}|${titleKey}`
    const catalogMatch = catalogKeys.get(key)
    if (catalogMatch) {
      duplicates.push({
        file,
        id: entry.id,
        title: entry.title,
        gameId: entry.gameId,
        duplicateOf: catalogMatch,
        dropped: true,
      })
      continue
    }
    const extraMatch = extraKeys.get(key)
    if (extraMatch) {
      duplicates.push({
        file,
        id: entry.id,
        title: entry.title,
        gameId: entry.gameId,
        duplicateOf: extraMatch,
        dropped: false,
      })
    } else extraKeys.set(key, entry.id)
    keptExtras.push(extraDraft(file, entry, artistIds))
  }
  const extraIds = new Set(keptExtras.map((e) => e.id))
  for (const [songId, { file }] of research)
    if (!catalogIds.has(songId) && !extraIds.has(songId)) unknownIds.push({ kind: "research", file, songId })
  for (const [songId, { file }] of associations)
    if (!catalogIds.has(songId) && !extraIds.has(songId)) unknownIds.push({ kind: "association", file, songId })

  // --- media helpers
  const local = (relative: string): string | null => (media.exists(relative) ? mediaUrl(relative) : null)
  const firstLocal = (...relatives: ReadonlyArray<string | null>): string | null => {
    for (const relative of relatives) {
      const found = relative ? local(relative) : null
      if (found) return found
    }
    return null
  }
  const isSkipped = (youtubeId: string) => inputs.videoClasses.get(youtubeId)?.role === "skip"
  const toVideo = (youtubeId: string, title: string, kind: VideoKind): TimelineVideo => ({
    youtubeId,
    title,
    kind,
    videoUrl: local(`video/${youtubeId}.mp4`),
    youtubeUrl: youtubeUrl(youtubeId),
    thumbnailUrl: local(`thumbs/${youtubeId}.jpg`) ?? youtubeThumbnail(youtubeId),
  })

  // --- entries
  const entries: Array<TimelineEntryDetail> = []
  const dateSources: Record<string, number> = {}
  let researchUsed = 0
  let associationsUsed = 0

  const finalize = (draft: Draft): TimelineEntryDetail | null => {
    const found = research.get(draft.id)?.entry ?? null
    const assocItem = associations.get(draft.id) ?? null
    const assoc = assocItem?.entry ?? null
    const assocFile = assocItem?.file ?? null
    if (found) researchUsed++
    if (assoc) associationsUsed++

    // Game
    let gameId = draft.gameId
    if (!gameIds.has(gameId)) unknownGames.push({ file: draft.file, songId: draft.id, gameId })
    if (assoc?.gameId) {
      if (gameIds.has(assoc.gameId)) gameId = assoc.gameId
      else unknownGames.push({ file: assocFile, songId: draft.id, gameId: assoc.gameId })
    }

    // Tags and categories
    const baseCategories = draft.categoryIds.filter((c) => categoryIds.has(c))
    const rawTags =
      assoc && assoc.tags !== null
        ? assoc.tags
        : deriveTags({
            title: draft.title,
            album: draft.album,
            artistNames: draft.artists.map((a) => a.name),
            categoryIds: dedupe([...draft.categoryIds, ...draft.ownTags]),
          })
    const tagFile = assoc && assoc.tags !== null ? assocFile : draft.file
    let entryTags = dedupe(rawTags).filter((tag) => {
      if (knownTags.has(tag)) return true
      unknownTags.push({ file: tagFile, songId: draft.id, tag })
      return false
    })
    if (entryTags.includes("worlds") && entryTags.includes("worlds-theme")) {
      const keep = draft.categoryIds.includes("worlds-theme")
        ? "worlds-theme"
        : draft.categoryIds.includes("worlds")
          ? "worlds"
          : isWorldsTheme(draft.title) || WORLDS_THEME_TEXT.test(draft.title)
            ? "worlds-theme"
            : "worlds"
      problems.push(`${draft.id}: tagged both worlds and worlds-theme — kept ${keep}`)
      entryTags = entryTags.filter((t) => t === keep || (t !== "worlds" && t !== "worlds-theme"))
    }
    let entryCategories = entryTags.filter((t) => categoryIds.has(t))
    if (entryCategories.length === 0) entryCategories = baseCategories
    const primaryCategoryId =
      draft.primaryCategoryId && entryCategories.includes(draft.primaryCategoryId)
        ? draft.primaryCategoryId
        : (entryCategories[0] ?? "soundtrack")
    if (entryCategories.length === 0) entryCategories = [primaryCategoryId]
    entryTags = dedupe([...entryTags, ...entryCategories])

    // Audio: association (string = use, null = none, absent = keep). The catalog already
    // respects the video-classes `skip` exclusions; curated ids are checked here.
    let audioId = draft.audioYoutubeId
    if (!draft.inArchive && audioId && isSkipped(audioId)) {
      excludedVideos.push({ songId: draft.id, youtubeId: audioId, field: "audio", reason: "video-classes role skip" })
      audioId = null
    }
    if (assoc && assoc.audioYoutubeId !== undefined) {
      if (assoc.audioYoutubeId !== null && isSkipped(assoc.audioYoutubeId)) {
        excludedVideos.push({
          songId: draft.id,
          youtubeId: assoc.audioYoutubeId,
          field: "audio",
          reason: "video-classes role skip (association ignored)",
        })
      } else audioId = assoc.audioYoutubeId
    }

    // Music video: same three-way rule
    let mvId = draft.musicVideo?.youtubeId ?? null
    let mvKind: VideoKind | null = draft.musicVideo?.kind ?? null
    if (!draft.inArchive && mvId && isSkipped(mvId)) {
      excludedVideos.push({ songId: draft.id, youtubeId: mvId, field: "musicVideo", reason: "video-classes role skip" })
      mvId = null
      mvKind = null
    }
    if (assoc && assoc.musicVideoYoutubeId !== undefined) {
      if (assoc.musicVideoYoutubeId !== null && isSkipped(assoc.musicVideoYoutubeId)) {
        excludedVideos.push({
          songId: draft.id,
          youtubeId: assoc.musicVideoYoutubeId,
          field: "musicVideo",
          reason: "video-classes role skip (association ignored)",
        })
      } else if (assoc.musicVideoYoutubeId !== mvId) {
        mvId = assoc.musicVideoYoutubeId
        mvKind = null
      }
    }
    if (assoc?.musicVideoKind && mvId) mvKind = assoc.musicVideoKind
    const catalogVideo = (id: string | null) => (id ? draft.videos.find((v) => v.youtubeId === id) : undefined)
    const mvCatalog = catalogVideo(mvId)
    const mvClass = mvId ? inputs.videoClasses.get(mvId) : undefined
    const musicVideo: TimelineVideo | null = mvId
      ? toVideo(
          mvId,
          mvCatalog?.title ??
            mvClass?.title ??
            (draft.musicVideo?.youtubeId === mvId ? draft.musicVideo.title : null) ??
            media.info(mvId)?.title ??
            draft.title,
          mvKind ?? mvCatalog?.kind ?? mvClass?.kind ?? "music_video",
        )
      : null
    const videos = dedupeBy(
      draft.videos.filter((v) => (v.role === "primary_mv" || v.role === "related") && v.youtubeId !== mvId),
      (v) => v.youtubeId,
    ).map((v) => toVideo(v.youtubeId, v.title, v.kind))

    // Files
    const audioUrl = audioId ? local(`audio/${audioId}.m4a`) : null
    const audioCatalog = catalogVideo(audioId)
    const uploadDate =
      mvCatalog?.uploadDate ??
      audioCatalog?.uploadDate ??
      (mvId && !mvCatalog ? media.info(mvId)?.uploadDate : null) ??
      (audioId && !audioCatalog ? media.info(audioId)?.uploadDate : null) ??
      null
    const duration = roundDuration(
      audioId
        ? (media.analysisDuration(audioId) ??
            audioCatalog?.durationSeconds ??
            (audioCatalog ? null : media.info(audioId)?.duration) ??
            null)
        : null,
    )
    const coverUrl =
      local(`covers/song-${draft.id}.jpg`) ??
      found?.coverUrl ??
      firstLocal(
        draft.coverYoutubeId ? `covers/${draft.coverYoutubeId}.jpg` : null,
        draft.coverYoutubeId ? `thumbs/${draft.coverYoutubeId}.jpg` : null,
      ) ??
      draft.coverUrl ??
      firstLocal(
        audioId ? `covers/${audioId}.jpg` : null,
        audioId ? `thumbs/${audioId}.jpg` : null,
        mvId ? `thumbs/${mvId}.jpg` : null,
      ) ??
      // Art-track thumbnails are the album art; music-video thumbnails are frames.
      (audioId ? youtubeThumbnail(audioId) : mvId ? youtubeThumbnail(mvId) : null)
    const palette =
      media.palette(`song-${draft.id}`) ??
      (draft.coverYoutubeId ? media.palette(draft.coverYoutubeId) : null) ??
      (audioId ? media.palette(audioId) : null) ??
      []
    const listenUrl = audioUrl
      ? null
      : audioId
        ? youtubeUrl(audioId)
        : (found?.spotifyUrl ?? draft.spotifyUrl ?? (musicVideo ? musicVideo.youtubeUrl : null))

    // Date: research → catalog release date → year (or the extra's date) → upload date
    const candidates: ReadonlyArray<{ readonly value: string | null; readonly source: DateSource }> = [
      { value: found?.date ?? null, source: "research" },
      ...draft.dates,
      { value: uploadDate, source: "upload-date" },
    ]
    let parsed: ParsedDate | null = null
    for (const candidate of candidates) {
      if (candidate.value === null || candidate.value === "") continue
      parsed = parseTimelineDate(candidate.value)
      if (parsed) {
        countInto(dateSources, candidate.source)
        break
      }
      invalidDates.push({ songId: draft.id, source: candidate.source, value: candidate.value })
    }
    if (!parsed) {
      problems.push(`${draft.id}: no usable date (left off the timeline)`)
      return null
    }

    const sources = dedupeBy([...(found?.sources ?? []), ...draft.sources], (s) => s.url)
    return {
      id: draft.id,
      inArchive: draft.inArchive,
      title: draft.title,
      displayArtist: draft.displayArtist,
      gameId,
      categoryIds: entryCategories,
      primaryCategoryId,
      tags: entryTags,
      date: parsed.date,
      datePrecision: parsed.precision,
      year: parsed.year,
      month: parsed.month,
      usedFor:
        found?.usedFor ??
        draft.usedFor ??
        genericUsedFor({
          title: draft.title,
          album: draft.album,
          gameId,
          primaryCategoryId,
          tags: entryTags,
          gameNames,
          tagNames,
        }),
      coverUrl,
      palette,
      audioUrl,
      duration,
      hasVideo: musicVideo !== null,
      viewCount: draft.viewCount,
      isImpact: draft.isImpact,
      album: draft.album,
      uploadDate,
      artists: draft.artists,
      background: found?.background ?? draft.background ?? null,
      musicVideo,
      videos,
      listenUrl,
      sources,
    }
  }

  for (const song of catalog.songs) {
    const entry = finalize(catalogDraft(song, artistNames))
    if (entry) entries.push(entry)
  }
  for (const draft of keptExtras) {
    const entry = finalize(draft)
    if (entry) entries.push(entry)
  }
  entries.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  // --- discs
  const discInputs: ReadonlyArray<Omit<TimelineDisc, "entryCount" | "firstYear" | "lastYear">> = inputs.timelineTaxonomy
    ? dedupeBy(inputs.timelineTaxonomy.discs, (d) => d.id)
    : [
        {
          id: "all",
          name: "The Complete Riot Discography",
          short: "ALL",
          kind: "all",
          description: "Every song Riot Games has released, in order.",
          color: "#1E88C8",
          gameIds: [],
          tags: [],
        },
      ]
  const unknownDiscReferences: Array<TimelineReport["taxonomy"]["unknownDiscReferences"][number]> = []
  const discs: Array<TimelineDisc> = discInputs.map((input) => {
    for (const id of input.gameIds)
      if (!gameIds.has(id)) unknownDiscReferences.push({ disc: input.id, kind: "game", id })
    for (const id of input.tags) if (!knownTags.has(id)) unknownDiscReferences.push({ disc: input.id, kind: "tag", id })
    const base: TimelineDisc = {
      id: input.id,
      name: input.name,
      short: input.short,
      kind: input.kind,
      description: input.description,
      color: input.color,
      gameIds: input.gameIds,
      tags: input.tags,
      entryCount: 0,
      firstYear: null,
      lastYear: null,
    }
    const on = entries.filter((e) => isOnDisc(e, base))
    return {
      ...base,
      entryCount: on.length,
      firstYear: on.length > 0 ? Math.min(...on.map((e) => e.year)) : null,
      lastYear: on.length > 0 ? Math.max(...on.map((e) => e.year)) : null,
    }
  })

  // --- report
  const byGame: Record<string, number> = {}
  const byYear: Record<string, number> = {}
  const byDatePrecision: Record<TimelineDatePrecision, number> = { day: 0, month: 0, year: 0 }
  for (const entry of entries) {
    countInto(byGame, entry.gameId)
    countInto(byYear, String(entry.year))
    byDatePrecision[entry.datePrecision]++
  }
  const count = (predicate: (e: TimelineEntryDetail) => boolean) => entries.filter(predicate).length
  const report: TimelineReport = {
    generatedAt: inputs.generatedAt,
    totals: {
      entries: entries.length,
      archive: count((e) => e.inArchive),
      extras: count((e) => !e.inArchive),
      withResearch: count((e) => research.has(e.id)),
      withAssociation: count((e) => associations.has(e.id)),
      withBackground: count((e) => e.background !== null),
      withAudio: count((e) => e.audioUrl !== null),
      withVideo: count((e) => e.hasVideo),
      withLocalVideo: count((e) => e.musicVideo?.videoUrl != null),
      withCover: count((e) => e.coverUrl !== null),
      withLocalCover: count((e) => e.coverUrl?.startsWith("/media/") === true),
      withPalette: count((e) => e.palette.length > 0),
      withDuration: count((e) => e.duration !== null),
    },
    inputs: {
      research: { files: inputs.files.research, entries: inputs.research.length, used: researchUsed },
      extras: { files: inputs.files.extras, entries: inputs.extras.length, kept: keptExtras.length },
      associations: { files: inputs.files.associations, entries: inputs.associations.length, used: associationsUsed },
    },
    byGame: sortedRecord(byGame),
    byDisc: Object.fromEntries(discs.map((d) => [d.id, d.entryCount])),
    byYear: sortedRecord(byYear, true),
    byDatePrecision,
    byDateSource: sortedRecord(dateSources),
    withoutBackground: entries.filter((e) => e.background === null).map((e) => e.id),
    unknownIds,
    unknownTags,
    unknownGames,
    invalidDates,
    duplicates,
    conflicts,
    droppedExtras,
    excludedVideos,
    taxonomy: { categoriesWithoutTag, unknownDiscReferences },
    problems,
  }
  return { data: { generatedAt: inputs.generatedAt, entries, discs, tags }, report }
}

function dedupeBy<A>(items: ReadonlyArray<A>, key: (a: A) => string): Array<A> {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
