import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Data, Effect, Option, Schedule } from "effect"
import { readCatalog, readJson, writeJson } from "../analysis/media-io.ts"
import { artistKeys, baseKey, indexCandidates, matchSong, versionKey } from "../artwork/match.ts"
import { songsForArtwork } from "../artwork/songs.ts"
import { paths } from "../paths.ts"

/**
 * Official album artwork from Apple Music (what coveratlas.com shows for
 * "League of Legends Music", artist 960030338), read through Apple's public
 * iTunes lookup API: every release of Riot's official music artists, with its
 * track list and the cover at 3000×3000.
 *
 * Songs released under another label (e.g. Imagine Dragons' "Warriors") are not
 * on Riot's pages; for catalog songs still without a confident Apple match the
 * stage runs a strict iTunes search (same title and version, a shared artist,
 * duration within a few seconds). Searches are cached in
 * data/sources/apple-search-cache.json so re-runs do not hit Apple again.
 *
 * Output: data/sources/apple.jsonl — one AppleTrack per line.
 */
export const appleFile = NodePath.join(paths.sources, "apple.jsonl")
const searchCacheFile = NodePath.join(paths.sources, "apple-search-cache.json")

/** Riot's official artist pages on Apple Music. Releases are further filtered by copyright. */
export const APPLE_ARTISTS: ReadonlyArray<{ readonly id: number; readonly name: string }> = [
  { id: 960030338, name: "League of Legends Music" },
  { id: 1572239459, name: "VALORANT Music" },
  { id: 1701115275, name: "VALORANT" },
  { id: 1809406088, name: "Teamfight Tactics Music" },
  { id: 1835992354, name: "2XKO Music" },
  { id: 1537758380, name: "League of Legends: Wild Rift" },
  { id: 1594814707, name: "Riot Forge" },
  // Riot's in-universe bands publish under their own artist pages.
  { id: 870541409, name: "Pentakill" },
  { id: 1439420229, name: "K/DA" },
  { id: 1484930017, name: "True Damage" },
  { id: 1709139239, name: "HEARTSTEEL" },
  { id: 1532969141, name: "Seraphine" },
]

export interface AppleTrack {
  readonly trackId: number
  readonly trackName: string
  readonly artistName: string
  readonly collectionId: number
  readonly collectionName: string
  readonly collectionArtistName: string | null
  /** "single" | "ep" | "album", from Apple's "- Single" / "- EP" naming. */
  readonly collectionKind: "single" | "ep" | "album"
  readonly collectionTrackCount: number | null
  readonly releaseDate: string | null
  readonly durationMs: number | null
  readonly trackNumber: number | null
  readonly discNumber: number | null
  /** Full-resolution cover (3000×3000). */
  readonly artworkUrl: string
  readonly collectionUrl: string | null
  readonly trackUrl: string | null
  readonly copyright: string | null
  /** "artist" = from Riot's artist pages; "search" = strict per-song search (other labels). */
  readonly via?: "artist" | "search"
}

class AppleLookupError extends Data.TaggedError("AppleLookupError")<{ readonly url: string; readonly reason: string }> {}

interface LookupResult {
  readonly wrapperType?: string
  readonly kind?: string
  readonly collectionId?: number
  readonly collectionName?: string
  readonly collectionArtistName?: string
  readonly artistName?: string
  readonly trackId?: number
  readonly trackName?: string
  readonly trackCount?: number
  readonly releaseDate?: string
  readonly trackTimeMillis?: number
  readonly trackNumber?: number
  readonly discNumber?: number
  readonly artworkUrl100?: string
  readonly collectionViewUrl?: string
  readonly trackViewUrl?: string
  readonly copyright?: string
}

// Apple allows roughly 20 lookups per minute; stay well under it and back off on 403/429.
const SPACING = "3500 millis"
const retryPolicy = Schedule.max([Schedule.exponential("10 seconds"), Schedule.recurs(4)])

const lookup = (params: string) => request(`https://itunes.apple.com/lookup?${params}&country=us&limit=200`)

const request = (url: string) => {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return ((await response.json()) as { results: ReadonlyArray<LookupResult> }).results
    },
    catch: (error) => new AppleLookupError({ url, reason: String(error) }),
  }).pipe(Effect.retry(retryPolicy), Effect.tap(() => Effect.sleep(SPACING)))
}

/** `…/100x100bb.jpg` → `…/3000x3000bb.jpg` (Apple serves the master up to its native size). */
export const fullSizeArtwork = (url: string) => url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, "/3000x3000bb.jpg")

const collectionKind = (name: string): AppleTrack["collectionKind"] =>
  / - Single$/i.test(name) ? "single" : / - EP$/i.test(name) ? "ep" : "album"

const isRiot = (copyright: string | undefined) => !copyright || /riot games/i.test(copyright)

export const appleStage = Effect.gen(function* () {
  // 1. Releases of every official artist.
  const collections = new Map<number, LookupResult>()
  for (const artist of APPLE_ARTISTS) {
    const results = yield* lookup(`id=${artist.id}&entity=album`)
    const albums = results.filter((r) => r.wrapperType === "collection" && r.collectionId && r.artworkUrl100)
    const riot = albums.filter((r) => isRiot(r.copyright))
    for (const album of riot) collections.set(album.collectionId!, album)
    yield* Effect.logInfo(
      `Apple: ${artist.name} — ${albums.length} releases (${albums.length - riot.length} skipped: not © Riot Games)`,
    )
  }

  // 2. Track lists, a few releases per lookup (each lookup returns at most 200 rows).
  const ids = [...collections.keys()]
  const tracks = new Map<number, AppleTrack>()
  const batches: Array<Array<number>> = []
  for (let i = 0; i < ids.length; i += 4) batches.push(ids.slice(i, i + 4))
  for (const [k, batch] of batches.entries()) {
    const results = yield* lookup(`id=${batch.join(",")}&entity=song`)
    for (const r of results) {
      if (r.wrapperType !== "track" || !r.trackId || !r.collectionId || !r.trackName) continue
      const album = collections.get(r.collectionId)
      if (!album) continue
      tracks.set(r.trackId, {
        trackId: r.trackId,
        trackName: r.trackName,
        artistName: r.artistName ?? "",
        collectionId: r.collectionId,
        collectionName: album.collectionName ?? r.collectionName ?? "",
        collectionArtistName: album.collectionArtistName ?? album.artistName ?? null,
        collectionKind: collectionKind(album.collectionName ?? ""),
        collectionTrackCount: album.trackCount ?? null,
        releaseDate: (album.releaseDate ?? r.releaseDate ?? "").slice(0, 10) || null,
        durationMs: r.trackTimeMillis ?? null,
        trackNumber: r.trackNumber ?? null,
        discNumber: r.discNumber ?? null,
        artworkUrl: fullSizeArtwork(album.artworkUrl100!),
        collectionUrl: album.collectionViewUrl ?? null,
        trackUrl: r.trackViewUrl ?? null,
        copyright: album.copyright ?? null,
        via: "artist",
      })
    }
    if ((k + 1) % 10 === 0 || k === batches.length - 1)
      yield* Effect.logInfo(`Apple: track lists ${k + 1}/${batches.length} lookups, ${tracks.size} tracks`)
  }

  // 3. Strict search for catalog songs Riot's pages do not cover.
  yield* searchMissing(tracks)

  const rows = [...tracks.values()].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.trackId - b.trackId)
  NodeFs.writeFileSync(appleFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8")
  yield* Effect.logInfo(`Wrote ${appleFile}: ${rows.length} tracks on ${collections.size} releases`)
})

/** Per-song iTunes search for catalog songs without a confident Apple match (results cached). */
const searchMissing = (tracks: Map<number, AppleTrack>) =>
  Effect.gen(function* () {
    const catalog = Option.getOrNull(yield* readCatalog)
    if (!catalog) return
    const cache: Record<string, ReadonlyArray<LookupResult>> = readJson(searchCacheFile) ?? {}
    const toCandidates = (list: ReadonlyArray<AppleTrack>) =>
      list.map((t) => ({
        source: "apple" as const,
        id: String(t.collectionId),
        title: t.trackName,
        artists: [t.artistName],
        duration: t.durationMs !== null ? t.durationMs / 1000 : null,
        artworkUrl: t.artworkUrl,
        pageUrl: t.collectionUrl ?? "",
        album: t.collectionName,
        releaseDate: t.releaseDate,
        collectionKind: t.collectionKind,
      }))
    const index = indexCandidates(toCandidates([...tracks.values()]))
    const songs = songsForArtwork(catalog).filter((song) => matchSong(song, index).status !== "auto")
    yield* Effect.logInfo(`Apple: ${songs.length} catalog songs without a confident match — searching (cached: ${Object.keys(cache).length})`)

    let added = 0
    for (const [k, song] of songs.entries()) {
      const artist = song.artistNames.find((name) => artistKeys([name]).size > 0) ?? ""
      const term = `${song.title.replace(/[([][^)\]]*[)\]]/g, " ")} ${artist}`.replace(/\s+/g, " ").trim()
      if (!cache[term]) {
        const results = yield* request(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=15&country=us`,
        ).pipe(Effect.catch(() => Effect.succeed<ReadonlyArray<LookupResult>>([])))
        cache[term] = results.filter((r) => r.wrapperType === "track")
        if (k % 20 === 0) writeJson(searchCacheFile, cache)
      }
      const songArtists = artistKeys(song.artistNames)
      for (const r of cache[term] ?? []) {
        if (!r.trackId || !r.collectionId || !r.trackName || !r.artworkUrl100 || tracks.has(r.trackId)) continue
        if (baseKey(r.trackName) !== baseKey(song.title) || versionKey(r.trackName) !== versionKey(song.title)) continue
        const theirs = artistKeys([r.artistName ?? "", r.collectionArtistName ?? ""])
        const shared = [...songArtists].some((a) => theirs.has(a))
        // Songs credited only to Riot's in-house team must come from a Riot release.
        if (!(shared || (songArtists.size === 0 && /league of legends|riot|valorant|teamfight/i.test(r.artistName ?? ""))))
          continue
        if (song.duration !== null && !song.durationFromVideo && r.trackTimeMillis && Math.abs(r.trackTimeMillis / 1000 - song.duration) > 4)
          continue
        const name = r.collectionName ?? ""
        tracks.set(r.trackId, {
          trackId: r.trackId,
          trackName: r.trackName,
          artistName: r.artistName ?? "",
          collectionId: r.collectionId,
          collectionName: name,
          collectionArtistName: r.collectionArtistName ?? r.artistName ?? null,
          collectionKind: collectionKind(name),
          collectionTrackCount: r.trackCount ?? null,
          releaseDate: (r.releaseDate ?? "").slice(0, 10) || null,
          durationMs: r.trackTimeMillis ?? null,
          trackNumber: r.trackNumber ?? null,
          discNumber: r.discNumber ?? null,
          artworkUrl: fullSizeArtwork(r.artworkUrl100),
          collectionUrl: r.collectionViewUrl ?? null,
          trackUrl: r.trackViewUrl ?? null,
          copyright: null,
          via: "search",
        })
        added++
      }
      if ((k + 1) % 25 === 0) yield* Effect.logInfo(`Apple: searched ${k + 1}/${songs.length}, ${added} tracks added`)
    }
    writeJson(searchCacheFile, cache)
    yield* Effect.logInfo(`Apple: search added ${added} tracks from other labels`)
  })
