/**
 * Pure string helpers for the catalog stage: title normalisation (matching),
 * display-title clean-up, slugs, artist keys and credit-line formatting.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested in isolation (packages/pipeline/test/catalog.test.ts).
 */

// ---------------------------------------------------------------------------
// Unicode folding

const LIGATURES: Readonly<Record<string, string>> = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  þ: "th",
  Þ: "Th",
  ı: "i",
}

/** Strip diacritics and expand a few ligatures: "Sofía" → "Sofia", "ØZI" → "OZI", "Renholdër" → "Renholder". */
export const fold = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[øØæÆœŒßłŁđĐþÞı]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')

// ---------------------------------------------------------------------------
// Titles

/** `(feat. X)`, `[ft. X]`, `(with X)`, `(featuring X)` anywhere in a title. */
const FEAT_BRACKET = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]*)[)\]]/gi
/** Trailing ` feat. X` / ` ft. X` without brackets. */
const FEAT_TRAILING = /\s+(?:feat\.|ft\.|featuring)\s+(.+)$/i
/**
 * Source-attribution suffixes that are not part of the song title:
 * `(From League of Legends: Season 5)`, `(from the series Arcane League of Legends)`,
 * `[from the series Arcane League of Legends]`, ` - from the series Arcane …`.
 */
const FROM_SUFFIX =
  /\s*[([](?:from|inspired by)\s+(?:the\s+(?:series|game|animated series)\s+)?[^)\]]*(?:League of Legends|Arcane|VALORANT|2XKO|Season \d+)[^)\]]*[)\]]/gi
const DASH_FROM_SUFFIX = /\s+-\s+from the (?:series|game) .*$/i

/**
 * Human-facing title: drops featured-artist and "from the series …" suffixes
 * (the credit line shows those) and tidies whitespace. Version markers such as
 * `(Remix)` or `(Opening Title Version)` are kept — they are different songs.
 */
export const displayTitle = (raw: string): string =>
  raw
    .replace(FROM_SUFFIX, "")
    .replace(DASH_FROM_SUFFIX, "")
    .replace(FEAT_BRACKET, "")
    .replace(FEAT_TRAILING, "")
    .replace(/\s+/g, " ")
    .trim()

/** The raw featured-artist text(s) of a title: "If The Sun… (feat. Oli Sykes & Courtney LaPlante)" → ["Oli Sykes & Courtney LaPlante"]. */
export const featuredText = (raw: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  const cleaned = raw.replace(FROM_SUFFIX, "")
  for (const match of cleaned.matchAll(FEAT_BRACKET)) if (match[1]) found.push(match[1].trim())
  const trailing = FEAT_TRAILING.exec(cleaned.replace(FEAT_BRACKET, ""))
  if (trailing?.[1]) found.push(trailing[1].trim())
  return found
}

/** Text inside one bracket group, allowing one nested "(…)": "Karol Suchecki (Poland) Remix". */
const GROUP_TEXT = String.raw`(?:[^()[\]]|\([^()]*\))*`
const REMIX_GROUP = new RegExp(String.raw`[([](${GROUP_TEXT}\b(?:remix|flip|rework|vip|bootleg)\b${GROUP_TEXT})[)\]]`, "gi")

/**
 * Parenthetical groups that describe a remix/edit: "Phoenix (Blanke Remix)" → ["Blanke Remix"],
 * "REMIX RUMBLE (Karol Suchecki (Poland) Remix)" → ["Karol Suchecki (Poland) Remix"].
 */
export const remixGroups = (raw: string): ReadonlyArray<string> => [...raw.matchAll(REMIX_GROUP)].map((m) => m[1]!.trim())

/**
 * Matching key for titles: folded, lower-case, feat./"from …" removed, `&` → `and`,
 * punctuation collapsed. Keeps any script (Arabic/CJK titles stay distinct).
 */
export const normalizeTitle = (raw: string): string =>
  fold(displayTitle(raw))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/** "The Music of League of Legends: Season 5" / "(From League of Legends: Season 5)" → 2015. */
export const seasonYear = (text: string | null | undefined): number | null => {
  if (!text) return null
  const match = /League of Legends:\s*Season\s+(\d{1,2})\b/i.exec(text)
  if (!match) return null
  const season = Number(match[1])
  if (!Number.isInteger(season) || season < 1 || season > 16) return null
  // Season One ran 2010–2011; from Season Two on, Season N ≈ 2010 + N.
  return season === 1 ? 2010 : 2010 + season
}

// ---------------------------------------------------------------------------
// Slugs and keys

/** 32-bit FNV-1a, hex. Used for slugs of titles/names with no Latin characters. */
export const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * kebab-case ASCII slug. Apostrophes and brackets are dropped without a
 * separator ("(G)I-DLE" → "gi-dle", "I'LL SHOW YOU" → "ill-show-you"),
 * `&` reads as "and", every other run of punctuation becomes one hyphen
 * ("POP/STARS" → "pop-stars"). Returns "" when nothing Latin is left.
 */
export const slugify = (text: string): string =>
  fold(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Slug with a deterministic fallback for non-Latin text: "حكاية أبطال" → "song-1a2b3c4d". */
export const slugOr = (text: string, prefix: string): string => slugify(text) || `${prefix}-${fnv1a(text)}`

/** Song id base: the title slug without featured artists. */
export const songSlug = (title: string): string => slugOr(displayTitle(title), "song")

/** Identity key for an artist name: case, accents, spacing and punctuation insensitive. */
export const nameKey = (name: string): string =>
  fold(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")

/** Split a free-text credit list ("A, B & C", "A and B", "A x B"). Only used when no structured artists exist. */
export const splitNames = (text: string): ReadonlyArray<string> =>
  text
    .split(/\s*(?:,|&|\band\b|\s[x×]\s)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

// ---------------------------------------------------------------------------
// Credit line

const joinNames = (names: ReadonlyArray<string>): string => {
  if (names.length <= 1) return names.join("")
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`
}

export interface CreditName {
  readonly name: string
  readonly role: "primary" | "featured" | "remixer" | "composer"
}

/**
 * Pre-formatted credit line: "K/DA ft. Madison Beer, (G)I-DLE, Jaira Burns",
 * "Imagine Dragons & JID". Falls back to remixers, then composers, then
 * "Riot Games Music" when a song has no performer credit at all.
 */
export const formatDisplayArtist = (credits: ReadonlyArray<CreditName>): string => {
  const names = (role: CreditName["role"]) => credits.filter((c) => c.role === role).map((c) => c.name)
  const primary = names("primary")
  const featured = names("featured")
  if (primary.length > 0) return featured.length > 0 ? `${joinNames(primary)} ft. ${featured.join(", ")}` : joinNames(primary)
  if (featured.length > 0) return joinNames(featured)
  const remixers = names("remixer")
  if (remixers.length > 0) return joinNames(remixers)
  const composers = names("composer")
  if (composers.length > 0) return joinNames(composers.slice(0, 3)) + (composers.length > 3 ? " et al." : "")
  return "Riot Games Music"
}

// ---------------------------------------------------------------------------
// Dates

/** yt-dlp `20170915` / ISO `2017-09-15` → `2017-09-15`; anything else → null. */
export const isoDate = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

export const yearOf = (date: string | null): number | null => (date ? Number(date.slice(0, 4)) : null)

/**
 * Best-effort repair of titles that lost a character to U+FFFD when the
 * channel listings were captured ("Thresh�s Music", "Motion Comic � League").
 * Only the unambiguous cases are fixed: an apostrophe before a contraction /
 * possessive, and a spaced dash.
 */
export const repairMojibake = (text: string): string =>
  text
    .replace(/(\p{L})\uFFFD(s|t|ll|re|ve|d|m)\b/gu, "$1\u2019$2")
    .replace(/(\p{L})\uFFFD(\p{Lu})/gu, "$1\u2019$2")
    .replace(/ \uFFFD /g, " \u2013 ")
