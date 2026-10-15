import { fold, nameKey, normalizeTitle, splitNames } from "../catalog/normalize.ts"

/**
 * Album-artwork matching: pair every catalog song with the official artwork of
 * its release. Sources, best first: Apple Music (Riot's official artist pages —
 * what coveratlas.com shows), SoundCloud (per-track art) and Spotify (per
 * release). A song prefers its own single's cover, then an EP, then the album.
 * Pure and deterministic; the `artwork` stage does the I/O.
 *
 * A match needs the same base title AND the same version (an instrumental, a
 * remix or an orchestral version has its own cover), then duration and credits
 * decide between candidates. Anything not clear-cut is marked `review`.
 */

export interface ArtworkCandidate {
  readonly source: "apple" | "soundcloud" | "spotify"
  /** Apple collection id / SoundCloud track id / Spotify release id. */
  readonly id: string
  readonly title: string
  readonly artists: ReadonlyArray<string>
  readonly duration: number | null
  readonly artworkUrl: string
  readonly pageUrl: string
  /** Album / set / release name, when known. */
  readonly album: string | null
  readonly releaseDate: string | null
  /** Release type when the source knows it (Apple). */
  readonly collectionKind?: "single" | "ep" | "album"
}

export interface SongForArtwork {
  readonly id: string
  readonly title: string
  readonly artistNames: ReadonlyArray<string>
  readonly duration: number | null
  /** Audio cut from a music video: its duration includes intros/outros, so duration is a weak signal. */
  readonly durationFromVideo: boolean
  readonly album: string | null
}

export interface ScoredCandidate {
  readonly candidate: ArtworkCandidate
  readonly score: number
  readonly reasons: ReadonlyArray<string>
}

export type MatchStatus = "auto" | "review" | "none"

export interface ArtworkMatch {
  readonly songId: string
  readonly status: MatchStatus
  readonly chosen: ArtworkCandidate | null
  readonly candidates: ReadonlyArray<ScoredCandidate>
}

// ---------------------------------------------------------------------------
// Titles

/** Words that make a bracketed/dashed suffix a *version* of the song rather than decoration. */
const VERSION_WORD =
  /\b(instrumental|remix|orchestral|orchestra|acoustic|version|edit|extended|live|lo-?fi|piano|symphonic|a ?cappella|slowed|sped|mix|rework|vip|flip|demo|cinematic|mashup|medley|cover|karaoke|teaser|preview|unplugged|reprise|ver\.)\b/i

const GROUP = /\s*[([]([^()[\]]*(?:\([^()]*\)[^()[\]]*)*)[)\]]/g
const DASH_SUFFIX = /\s+[-–—]\s+([^-–—]+)$/

/** Normalised version descriptor: "Phoenix (Blanke Remix)" → "blanke remix"; "Enemy" → "". */
export const versionKey = (raw: string): string => {
  const parts: Array<string> = []
  for (const match of raw.matchAll(GROUP)) if (match[1] && VERSION_WORD.test(match[1])) parts.push(match[1])
  const dash = DASH_SUFFIX.exec(raw.replace(GROUP, ""))
  if (dash?.[1] && VERSION_WORD.test(dash[1])) parts.push(dash[1])
  return parts
    .map((p) =>
      fold(p)
        .toLowerCase()
        .replace(/\b(official|from|league of legends|the series|arcane|feat\.?|ft\.?)\b/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .filter((p) => p.length > 0)
    .sort()
    .join(" | ")
}

/** Title without any bracket groups or dashed version suffix: "Legends Never Die (Alan Walker Remix)" → "legends never die". */
export const baseKey = (raw: string): string => {
  const withoutGroups = raw.replace(GROUP, " ")
  const dash = DASH_SUFFIX.exec(withoutGroups)
  const stripped = dash?.[1] && VERSION_WORD.test(dash[1]) ? withoutGroups.slice(0, dash.index) : withoutGroups
  return normalizeTitle(stripped) || normalizeTitle(raw)
}

const tokens = (text: string) => new Set(text.split(" ").filter((t) => t.length > 0))

const jaccard = (a: string, b: string) => {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

/** Labels that appear as "artists" on Riot's official uploads but are not performers. */
const LABEL_ARTISTS = new Set(
  ["League of Legends", "Riot Games", "Riot Games Music", "VALORANT", "Teamfight Tactics", "2XKO", "Arcane", "Legends of Runeterra"].map(
    nameKey,
  ),
)

/** Performer keys from a free-text or structured credit list (labels removed). */
export const artistKeys = (names: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(
    names
      .flatMap((n) => splitNames(n.replace(/，/g, ",").replace(/\b(?:feat\.?|ft\.?|featuring)\b/gi, ",")))
      .map(nameKey)
      .filter((k) => k.length > 0 && !LABEL_ARTISTS.has(k)),
  )

// ---------------------------------------------------------------------------
// Scoring

export const scoreCandidate = (song: SongForArtwork, candidate: ArtworkCandidate): ScoredCandidate | null => {
  const reasons: Array<string> = []
  const songBase = baseKey(song.title)
  const candBase = baseKey(candidate.title)
  let score = 0
  if (songBase === candBase) {
    score += 6
    reasons.push("same title")
  } else {
    const similarity = jaccard(songBase, candBase)
    if (similarity < 0.75) return null
    score += 3 * similarity
    reasons.push(`similar title (${similarity.toFixed(2)})`)
  }

  const songVersion = versionKey(song.title)
  const candVersion = versionKey(candidate.title)
  if (songVersion !== candVersion) {
    // Different versions have different covers; never match them.
    return null
  }
  if (songVersion) reasons.push(`same version (${songVersion})`)

  if (song.duration !== null && candidate.duration !== null) {
    const delta = Math.abs(song.duration - candidate.duration)
    const weight = song.durationFromVideo ? 0.35 : 1
    if (delta <= 2) score += 3 * weight
    else if (delta <= 5) score += 2 * weight
    else if (delta <= 10) score += 0.5 * weight
    else if (delta <= 25) score -= 1.5 * weight
    else score -= 4 * weight
    reasons.push(`Δ${delta.toFixed(1)}s`)
  }

  const songArtists = artistKeys(song.artistNames)
  const candArtists = artistKeys(candidate.artists)
  if (songArtists.size > 0 && candArtists.size > 0) {
    let overlap = 0
    for (const a of songArtists) if (candArtists.has(a)) overlap++
    if (overlap > 0) {
      score += 1 + Math.min(overlap, 3) * 0.5
      reasons.push(`${overlap} shared artist(s)`)
    } else {
      score -= 1.5
      reasons.push("no shared artist")
    }
  }

  if (song.album && candidate.album && normalizeTitle(song.album) === normalizeTitle(candidate.album)) {
    score += 1
    reasons.push("same album")
  }
  // Official Apple covers first, then per-track SoundCloud art, then Spotify.
  if (candidate.source === "apple") score += 1.5
  else if (candidate.source === "soundcloud") score += 0.25
  // The song's own single (or EP) cover beats the compilation album it also appears on.
  if (candidate.collectionKind && candidate.album) {
    const release = baseKey(candidate.album.replace(/\s+-\s+(Single|EP)$/i, ""))
    if (candidate.collectionKind === "single" && release === songBase) {
      score += 1
      reasons.push("own single")
    } else if (candidate.collectionKind === "ep") {
      score += 0.3
      reasons.push("EP")
    }
  }
  return { candidate, score, reasons }
}

const AUTO_SCORE = 8.5
const REVIEW_SCORE = 5

export const matchSong = (song: SongForArtwork, index: ReadonlyMap<string, ReadonlyArray<ArtworkCandidate>>): ArtworkMatch => {
  const pool = new Map<string, ArtworkCandidate>()
  const base = baseKey(song.title)
  for (const c of index.get(base) ?? []) pool.set(`${c.source}:${c.id}`, c)
  // Fuzzy fallback over keys sharing the first token (cheap pre-filter).
  const first = base.split(" ")[0] ?? ""
  if (pool.size === 0 && first) {
    for (const [key, list] of index) if (key.split(" ")[0] === first) for (const c of list) pool.set(`${c.source}:${c.id}`, c)
  }
  const scored = [...pool.values()]
    .map((c) => scoreCandidate(song, c))
    .filter((s): s is ScoredCandidate => s !== null && s.score >= REVIEW_SCORE)
    .sort((a, b) => b.score - a.score || (a.candidate.releaseDate ?? "9").localeCompare(b.candidate.releaseDate ?? "9"))
  const top = scored[0]
  if (!top) return { songId: song.id, status: "none", chosen: null, candidates: [] }
  // A real alternative = another cover from the same source that is not just the
  // same recording on another Apple release (single vs album: the release
  // preference already chose). Same-titled SoundCloud uploads with different art stay ambiguous.
  const sameRecording = (s: ScoredCandidate) =>
    s.candidate.source === "apple" &&
    baseKey(s.candidate.title) === baseKey(top.candidate.title) &&
    versionKey(s.candidate.title) === versionKey(top.candidate.title) &&
    (s.candidate.duration === null || top.candidate.duration === null || Math.abs(s.candidate.duration - top.candidate.duration) <= 2)
  const runnerUp = scored.find(
    (s) => s !== top && s.candidate.source === top.candidate.source && s.candidate.artworkUrl !== top.candidate.artworkUrl && !sameRecording(s),
  )
  const clearWinner = !runnerUp || top.score - runnerUp.score >= 1.5
  const status: MatchStatus = top.score >= AUTO_SCORE && clearWinner ? "auto" : "review"
  return { songId: song.id, status, chosen: top.candidate, candidates: scored.slice(0, 4) }
}

/** Group candidates by base title for fast lookup. */
export const indexCandidates = (candidates: ReadonlyArray<ArtworkCandidate>): ReadonlyMap<string, ReadonlyArray<ArtworkCandidate>> => {
  const index = new Map<string, Array<ArtworkCandidate>>()
  for (const c of candidates) {
    const key = baseKey(c.title)
    const list = index.get(key) ?? []
    list.push(c)
    index.set(key, list)
  }
  return index
}
