import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { databasePath, resetSchema, sqliteLayer } from "@workspace/db"
import { mediaUrl } from "@workspace/db/domain/media"
import { Data, Effect } from "effect"
import { SqlClient } from "effect/sql"
import sharp from "sharp"
import { FINGERPRINT_SIZE, groupSamePictures } from "../analysis/cover-identity.ts"
import { describe } from "../analysis/media-io.ts"
import { loadImpactFiles, loadTaxonomy, readJson } from "../catalog/inputs.ts"
import { fold, nameKey, normalizeTitle } from "../catalog/normalize.ts"
import type { AlignmentFile, AudioAnalysisFile, Catalog, CatalogSong, PaletteFile } from "../catalog/types.ts"
import { paths } from "../paths.ts"
import { catalogFile } from "./catalog.ts"

/**
 * `npm run pipeline -- build-db`: recreate `data/riot-music.db` from
 * `data/catalog.json`, the curated research (`data/curated/{taxonomy,awards,impact}`)
 * and whatever derived media exists (`media/analysis`, covers, gifs, clips).
 * Every derived input is optional, so the database can be rebuilt at any point
 * of the pipeline and simply gets richer as later stages finish.
 */

export class BuildDbError extends Data.TaggedError("BuildDbError")<{ readonly message: string }> {}

type Row = Record<string, string | number | null>

/** `media/<relative>` exists → the relative path with forward slashes, else null. */
const mediaPath = (relative: string): string | null =>
  NodeFs.existsSync(NodePath.join(paths.media, relative)) ? relative.replace(/\\/g, "/") : null

const firstMedia = (...relatives: ReadonlyArray<string | null>): string | null => {
  for (const relative of relatives) {
    if (relative === null) continue
    const found = mediaPath(relative)
    if (found) return found
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value : null)
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

const readAnalysis = (youtubeId: string): AudioAnalysisFile | null => {
  const json = readJson(NodePath.join(paths.analysis, `${youtubeId}.json`))
  return isRecord(json) && typeof json.peaks === "string" ? (json as unknown as AudioAnalysisFile) : null
}

const readPalette = (youtubeId: string | null): ReadonlyArray<string> => {
  if (!youtubeId) return []
  const json = readJson(NodePath.join(paths.analysis, "palette", `${youtubeId}.json`)) as PaletteFile | null
  return isRecord(json) && Array.isArray(json.colors) ? json.colors.filter((c): c is string => typeof c === "string") : []
}

/** Each cover's fingerprint (`analysis/cover-identity.ts`); a cover that fails to decode is left out. */
const coverFingerprints = (covers: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const out = new Map<string, Uint8Array>()
    yield* Effect.forEach(
      covers,
      (cover) =>
        Effect.tryPromise(() =>
          sharp(NodePath.join(paths.media, cover))
            .resize(FINGERPRINT_SIZE, FINGERPRINT_SIZE, { fit: "fill" })
            .removeAlpha()
            .toColourspace("srgb") // greyscale/CMYK covers still give 3 channels, comparable with the rest
            .raw()
            .toBuffer(),
        ).pipe(
          Effect.map((data) => void out.set(cover, new Uint8Array(data))),
          Effect.catch((error) => Effect.logWarning(`cover ${cover}: no fingerprint (${describe(error)})`)),
        ),
      { concurrency: 8, discard: true },
    )
    return out
  })

/** Every `media/analysis/align/<songId>__<videoId>.json`, grouped by song id. */
const readAlignments = (): ReadonlyMap<string, ReadonlyArray<AlignmentFile>> => {
  const dir = NodePath.join(paths.analysis, "align")
  const out = new Map<string, Array<AlignmentFile>>()
  let files: ReadonlyArray<string> = []
  try {
    files = NodeFs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.includes("__"))
  } catch {
    return out
  }
  for (const file of [...files].sort()) {
    const json = readJson(NodePath.join(dir, file))
    if (!isRecord(json) || !Array.isArray(json.segments)) continue
    const [songId, videoId] = file.replace(/\.json$/, "").split("__") as [string, string]
    const alignment = { ...(json as unknown as AlignmentFile), songId, videoId }
    const list = out.get(songId) ?? []
    list.push(alignment)
    out.set(songId, list)
  }
  return out
}

/** Song duration: analysis file, else the art track / video duration from the catalog. */
const songDuration = (song: CatalogSong, analysis: AudioAnalysisFile | null): number | null => {
  if (analysis && Number.isFinite(analysis.duration) && analysis.duration > 0) return analysis.duration
  const audioVideo = song.audio ? song.videos.find((v) => v.youtubeId === song.audio!.youtubeId) : undefined
  return audioVideo?.durationSeconds ?? null
}

const searchText = (song: CatalogSong, artistNames: ReadonlyArray<string>, categoryNames: ReadonlyArray<string>): string => {
  const text = [song.title, song.displayArtist, ...artistNames, song.album ?? "", ...categoryNames, ...song.categoryIds]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
  const folded = fold(text)
  return folded === text ? text : `${text} ${folded}`
}

// ---------------------------------------------------------------------------
// Awards

interface AwardRow extends Row {
  id: string
  year: number
  ceremony: string
  organization: string
  award: string
  result: string
  recipient: string
  project: string
  game_id: string | null
  music_related: number
  song_title: string | null
  song_id: string | null
  source_urls: string
  notes: string | null
}

/** Award entry → `awards` row; `songTitle` is resolved to a song id by normalised title (+ recipient credits). */
const awardRows = (
  catalog: Catalog,
  artistNames: ReadonlyMap<string, string>,
  gameIds: ReadonlySet<string>,
): { rows: ReadonlyArray<AwardRow>; skipped: number; files: number } => {
  const dir = NodePath.join(paths.curated, "awards")
  let files: ReadonlyArray<string> = []
  try {
    files = NodeFs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  } catch {
    return { rows: [], skipped: 0, files: 0 }
  }
  const byTitle = new Map<string, Array<CatalogSong>>()
  for (const song of catalog.songs) {
    const key = normalizeTitle(song.title)
    byTitle.set(key, [...(byTitle.get(key) ?? []), song])
  }
  const resolveSong = (title: string | null, recipient: string): string | null => {
    if (!title) return null
    const candidates = byTitle.get(normalizeTitle(title)) ?? []
    if (candidates.length <= 1) return candidates[0]?.id ?? null
    const recipientKey = nameKey(recipient)
    const credited = (s: CatalogSong) =>
      s.artists.filter((a) => {
        const key = nameKey(artistNames.get(a.id) ?? "")
        return key.length > 0 && recipientKey.includes(key)
      }).length
    return [...candidates].sort(
      (a, b) =>
        credited(b) - credited(a) ||
        Number(b.isImpact) - Number(a.isImpact) ||
        (b.viewCount ?? -1) - (a.viewCount ?? -1),
    )[0]!.id
  }

  const rows = new Map<string, AwardRow>()
  let skipped = 0
  for (const file of files) {
    const json = readJson(NodePath.join(dir, file))
    const entries: ReadonlyArray<unknown> = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.awards) ? json.awards : []
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      const id = str(entry.id)
      const year = num(entry.year)
      const award = str(entry.award)
      if (!id || year === null || !award || rows.has(id)) {
        skipped++
        continue
      }
      const recipient = str(entry.recipient) ?? ""
      const songTitle = str(entry.songTitle)
      const game = str(entry.game) ?? str(entry.gameId)
      const result = (str(entry.result) ?? "").toLowerCase()
      rows.set(id, {
        id,
        year,
        ceremony: str(entry.ceremony) ?? "",
        organization: str(entry.organization) ?? "",
        award,
        result: result === "won" || result === "win" || result === "winner" ? "won" : "nominated",
        recipient,
        project: str(entry.project) ?? "",
        game_id: game && gameIds.has(game) ? game : null,
        music_related: entry.musicRelated === true ? 1 : 0,
        song_title: songTitle,
        song_id: resolveSong(songTitle, recipient),
        source_urls: JSON.stringify(Array.isArray(entry.sourceUrls) ? entry.sourceUrls.filter((u) => typeof u === "string") : []),
        notes: str(entry.notes),
      })
    }
  }
  return { rows: [...rows.values()], skipped, files: files.length }
}

// ---------------------------------------------------------------------------
// Impact stories

const impactRows = (catalog: Catalog): ReadonlyArray<Row> => {
  const songBySlug = new Map(catalog.songs.flatMap((s) => (s.impactSlug ? [[s.impactSlug, s.id] as const] : [])))
  return loadImpactFiles().map(({ json }) => {
    const slug = String(json.slug)
    const songId = songBySlug.get(slug) ?? null
    const clip = isRecord(json.featuredClip) ? json.featuredClip : null
    const data = {
      ...json,
      slug,
      songId,
      featuredClip: clip
        ? {
            ...clip,
            clipUrl: mediaUrl(mediaPath(`clips/${slug}.mp4`)),
            gifUrl: mediaUrl(mediaPath(`clips/${slug}.gif`)),
          }
        : null,
    }
    return { slug, rank: num(json.rank) ?? 999, song_id: songId, data: JSON.stringify(data) }
  })
}

// ---------------------------------------------------------------------------
// Stage

const readCatalog = (): Catalog | null => {
  const json = readJson(catalogFile)
  return isRecord(json) && Array.isArray(json.songs) && Array.isArray(json.artists) ? (json as unknown as Catalog) : null
}

const insertAll = (table: string, rows: ReadonlyArray<Row>) =>
  Effect.gen(function* () {
    if (rows.length === 0) return
    const sql = yield* SqlClient.SqlClient
    const columns = Object.keys(rows[0]!).length
    // Stay well below SQLite's bound-parameter limit (32766).
    const size = Math.max(1, Math.floor(16000 / columns))
    for (let i = 0; i < rows.length; i += size) yield* sql`INSERT INTO ${sql(table)} ${sql.insert(rows.slice(i, i + size))}`
  })

export const buildDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const catalog = readCatalog()
  if (!catalog) {
    return yield* new BuildDbError({ message: "data/catalog.json is missing — run `npm run pipeline -- catalog` first" })
  }
  const taxonomy = loadTaxonomy()
  const gameIds = new Set(taxonomy.games.map((g) => g.id))
  const categoryIds = new Set(taxonomy.categories.map((c) => c.id))
  const categoryNames = new Map(taxonomy.categories.map((c) => [c.id, c.name]))
  const artistNames = new Map(catalog.artists.map((a) => [a.id, a.name]))

  // Assemble every row up front (pure file reads), then write in one transaction.
  // Hidden games (no music of their own on the site) keep their ids for awards
  // and labels but get no row, so they never appear in game lists.
  const hiddenGames = new Set(taxonomy.games.filter((g) => g.hidden).map((g) => g.id))
  const games = taxonomy.games
    .filter((g) => !g.hidden)
    .map((g, sort) => ({ id: g.id, name: g.name, short: g.short, color: g.color, sort }))
  const categories = taxonomy.categories.map((c, sort) => ({ id: c.id, name: c.name, description: c.description, sort }))
  const artists = catalog.artists.map((a) => ({ id: a.id, name: a.name, kind: a.kind, bio: null, image_url: null }))

  const songs: Array<Row> = []
  const songCategories: Array<Row> = []
  const songArtists: Array<Row> = []
  const videos: Array<Row> = []
  const analyses: Array<Row> = []
  const alignments: Array<Row> = []
  const alignmentFiles = readAlignments()
  const seenVideos = new Set<string>()
  const problems: Array<string> = []

  for (const song of catalog.songs) {
    if (!gameIds.has(song.gameId)) problems.push(`${song.id}: unknown game ${song.gameId}`)
    else if (hiddenGames.has(song.gameId)) problems.push(`${song.id}: game ${song.gameId} is hidden in taxonomy.json`)
    if (!categoryIds.has(song.primaryCategoryId)) problems.push(`${song.id}: unknown category ${song.primaryCategoryId}`)
    const audioId = song.audio?.youtubeId ?? null
    const analysis = audioId ? readAnalysis(audioId) : null
    const cover = song.coverYoutubeId
    // Official album artwork (the `artwork` stage) wins over YouTube-derived covers.
    const artworkCover = mediaPath(`covers/song-${song.id}.jpg`)
    songs.push({
      id: song.id,
      title: song.title,
      display_artist: song.displayArtist,
      game_id: song.gameId,
      primary_category_id: song.primaryCategoryId,
      album: song.album,
      year: song.year,
      release_date: song.releaseDate,
      duration: songDuration(song, analysis),
      audio_video_id: audioId,
      audio_kind: song.audio?.kind ?? null,
      audio_path: audioId ? mediaPath(`audio/${audioId}.m4a`) : null,
      mv_video_id: song.musicVideo?.youtubeId ?? null,
      cover_path: firstMedia(
        artworkCover,
        cover ? `covers/${cover}.jpg` : null,
        cover ? `thumbs/${cover}.jpg` : null,
        song.musicVideo ? `thumbs/${song.musicVideo.youtubeId}.jpg` : null,
        audioId ? `thumbs/${audioId}.jpg` : null,
      ),
      cover_key: null, // filled in below, once every cover is known
      palette: JSON.stringify(artworkCover ? readPalette(`song-${song.id}`) : readPalette(cover)),
      gif_path: mediaPath(`gifs/${song.id}.gif`),
      view_count: song.viewCount,
      description: song.description,
      is_impact: song.isImpact ? 1 : 0,
      search_text: searchText(
        song,
        song.artists.map((a) => artistNames.get(a.id) ?? a.id),
        song.categoryIds.map((c) => categoryNames.get(c) ?? c),
      ),
    })
    for (const categoryId of song.categoryIds) {
      if (categoryIds.has(categoryId)) songCategories.push({ song_id: song.id, category_id: categoryId })
      else problems.push(`${song.id}: unknown category ${categoryId}`)
    }
    const seenCredits = new Set<string>()
    song.artists.forEach((artist, position) => {
      const key = `${artist.id}|${artist.role}`
      if (seenCredits.has(key)) return
      seenCredits.add(key)
      if (!artistNames.has(artist.id)) problems.push(`${song.id}: unknown artist ${artist.id}`)
      songArtists.push({ song_id: song.id, artist_id: artist.id, role: artist.role, position })
    })
    for (const video of song.videos) {
      if (seenVideos.has(video.youtubeId)) {
        problems.push(`${song.id}: video ${video.youtubeId} already linked to another song`)
        continue
      }
      seenVideos.add(video.youtubeId)
      videos.push({
        id: video.youtubeId,
        song_id: song.id,
        source: video.source,
        title: video.title,
        kind: video.kind,
        role: video.role,
        duration: video.durationSeconds,
        upload_date: video.uploadDate,
        view_count: video.viewCount,
        video_path: mediaPath(`video/${video.youtubeId}.mp4`),
        thumbnail_path: mediaPath(`thumbs/${video.youtubeId}.jpg`),
      })
    }
    if (analysis) {
      analyses.push({
        song_id: song.id,
        bpm: analysis.bpm,
        bpm_confidence: analysis.bpmConfidence,
        beats: JSON.stringify(analysis.beats ?? []),
        peaks: analysis.peaks,
        peaks_rate: analysis.peaksRate,
        chorus_start: analysis.chorus?.start ?? null,
        chorus_end: analysis.chorus?.end ?? null,
        analyzed_at: analysis.analyzedAt ?? null,
      })
    }
    const videoIds = new Set(song.videos.map((v) => v.youtubeId))
    for (const alignment of alignmentFiles.get(song.id) ?? []) {
      if (!videoIds.has(alignment.videoId)) continue
      alignments.push({
        song_id: song.id,
        video_id: alignment.videoId,
        segments: JSON.stringify(alignment.segments),
        coverage: alignment.coverage,
        confidence: alignment.confidence,
        method: alignment.method,
        song_duration: alignment.songDuration,
        video_duration: alignment.videoDuration,
      })
    }
  }

  // Album tracks often share one picture under different files (re-uploads, singles that only
  // change the printed title): give every cover the key of its picture.
  const coverPaths = [...new Set(songs.flatMap((s) => (typeof s.cover_path === "string" ? [s.cover_path] : [])))]
  const pictureOf = groupSamePictures(yield* coverFingerprints(coverPaths))
  for (const song of songs) {
    if (typeof song.cover_path === "string") song.cover_key = pictureOf.get(song.cover_path) ?? song.cover_path
  }

  const awards = awardRows(catalog, artistNames, gameIds)
  const stories = impactRows(catalog)

  const file = databasePath()
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* resetSchema
      yield* insertAll("games", games)
      yield* insertAll("categories", categories)
      yield* insertAll("artists", artists)
      yield* insertAll("songs", songs)
      yield* insertAll("song_categories", songCategories)
      yield* insertAll("song_artists", songArtists)
      yield* insertAll("videos", videos)
      yield* insertAll("song_analysis", analyses)
      yield* insertAll("alignments", alignments)
      yield* insertAll("awards", awards.rows)
      yield* insertAll("impact_stories", stories)
    }),
  )
  yield* sql`VACUUM`.pipe(Effect.ignore)

  for (const problem of problems) yield* Effect.logWarning(problem)
  const count = (rows: ReadonlyArray<Row>, column: string) => rows.filter((r) => r[column] !== null).length
  yield* Effect.logInfo(
    `Built ${NodePath.relative(paths.root, file)}: ${games.length} games, ${categories.length} categories, ` +
      `${artists.length} artists, ${songs.length} songs (${count(songs, "audio_path")} with audio file, ` +
      `${count(songs, "cover_path")} with cover showing ${new Set(songs.map((s) => s.cover_key).filter((k) => k !== null)).size} pictures, ` +
      `${count(songs, "gif_path")} with gif), ` +
      `${songCategories.length} song categories, ${songArtists.length} credits, ${videos.length} videos ` +
      `(${count(videos, "video_path")} downloaded), ${analyses.length} analyses, ${alignments.length} alignments, ` +
      `${awards.rows.length} awards from ${awards.files} files (${awards.rows.filter((a) => a.song_id).length} linked to songs, ` +
      `${awards.skipped} skipped), ${stories.length} impact stories (${stories.filter((s) => s.song_id).length} linked)`,
  )
})

/** The stage with its own read-write SQLite connection to `data/riot-music.db`. */
export const buildDb = buildDatabase.pipe(Effect.provide(sqliteLayer({ filename: databasePath() })))
