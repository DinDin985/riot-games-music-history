import { SqliteClient } from "@effect/sql-sqlite-node"
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import type { Alignment, AlignmentSegment } from "./domain/alignment.ts"
import { mediaUrl, youtubeThumbnail, youtubeUrl } from "./domain/media.ts"
import type {
  ArchiveStats,
  ArtistDetail,
  ArtistKind,
  ArtistRole,
  ArtistSummary,
  AudioKind,
  Award,
  Category,
  Game,
  ImpactStory,
  Page,
  SongAnalysis,
  SongDetail,
  SongFilter,
  SongSummary,
  VideoKind,
  VideoRef,
  VideoRole,
} from "./domain/types.ts"
import { databasePath } from "./paths.ts"

// ---------------------------------------------------------------------------
// Rows

interface SongRow {
  readonly id: string
  readonly title: string
  readonly display_artist: string
  readonly game_id: string
  readonly primary_category_id: string
  readonly album: string | null
  readonly year: number | null
  readonly release_date: string | null
  readonly duration: number | null
  readonly audio_video_id: string | null
  readonly audio_kind: string | null
  readonly audio_path: string | null
  readonly mv_video_id: string | null
  readonly mv_path: string | null
  readonly cover_path: string | null
  readonly cover_key: string | null
  readonly palette: string
  readonly gif_path: string | null
  readonly view_count: number | null
  readonly description: string | null
  readonly is_impact: number
  readonly category_ids: string | null
}

interface VideoRow {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly role: string
  readonly duration: number | null
  readonly upload_date: string | null
  readonly view_count: number | null
  readonly video_path: string | null
  readonly thumbnail_path: string | null
}

const parseJson = <A>(text: string | null | undefined, fallback: A): A => {
  if (!text) return fallback
  try {
    return JSON.parse(text) as A
  } catch {
    return fallback
  }
}

const toSummary = (row: SongRow): SongSummary => ({
  id: row.id,
  title: row.title,
  displayArtist: row.display_artist,
  gameId: row.game_id,
  primaryCategoryId: row.primary_category_id,
  categoryIds: row.category_ids ? row.category_ids.split(",") : [],
  year: row.year,
  duration: row.duration,
  viewCount: row.view_count,
  isImpact: row.is_impact === 1,
  hasAudio: row.audio_path !== null,
  hasVideo: row.mv_path !== null,
  audioUrl: mediaUrl(row.audio_path),
  coverUrl: mediaUrl(row.cover_path),
  coverKey: row.cover_key,
  gifUrl: mediaUrl(row.gif_path),
  palette: parseJson<ReadonlyArray<string>>(row.palette, []),
})

const toVideoRef = (row: VideoRow): VideoRef => ({
  id: row.id,
  title: row.title,
  kind: row.kind as VideoKind,
  role: row.role as VideoRole,
  duration: row.duration,
  uploadDate: row.upload_date,
  viewCount: row.view_count,
  videoUrl: mediaUrl(row.video_path),
  youtubeUrl: youtubeUrl(row.id),
  thumbnailUrl: mediaUrl(row.thumbnail_path) ?? youtubeThumbnail(row.id),
})

// ---------------------------------------------------------------------------
// Service

export interface MusicRepoShape {
  readonly stats: Effect.Effect<ArchiveStats, SqlError>
  readonly listGames: Effect.Effect<ReadonlyArray<Game>, SqlError>
  readonly listCategories: Effect.Effect<ReadonlyArray<Category>, SqlError>
  readonly listSongs: (filter?: SongFilter) => Effect.Effect<Page<SongSummary>, SqlError>
  readonly listSongIds: Effect.Effect<ReadonlyArray<string>, SqlError>
  readonly getSong: (id: string) => Effect.Effect<SongDetail | null, SqlError>
  readonly getSongs: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<SongSummary>, SqlError>
  readonly relatedSongs: (id: string, limit?: number) => Effect.Effect<ReadonlyArray<SongSummary>, SqlError>
  readonly getAnalysis: (songId: string) => Effect.Effect<SongAnalysis | null, SqlError>
  readonly getAlignment: (songId: string) => Effect.Effect<Alignment | null, SqlError>
  readonly listArtists: (options?: {
    readonly q?: string | undefined
    readonly kind?: ArtistKind | undefined
  }) => Effect.Effect<ReadonlyArray<ArtistSummary>, SqlError>
  readonly getArtist: (id: string) => Effect.Effect<ArtistDetail | null, SqlError>
  readonly listYears: Effect.Effect<ReadonlyArray<{ readonly year: number; readonly songCount: number }>, SqlError>
  readonly listAwards: Effect.Effect<ReadonlyArray<Award>, SqlError>
  readonly listImpactStories: Effect.Effect<ReadonlyArray<ImpactStory>, SqlError>
  readonly getImpactStory: (slug: string) => Effect.Effect<ImpactStory | null, SqlError>
}

export class MusicRepo extends Context.Service<MusicRepo, MusicRepoShape>()("@workspace/db/MusicRepo") {}

const SONG_COLUMNS = `
  s.id, s.title, s.display_artist, s.game_id, s.primary_category_id, s.album, s.year, s.release_date,
  s.duration, s.audio_video_id, s.audio_kind, s.audio_path, s.mv_video_id, s.cover_path, s.cover_key, s.palette,
  s.gif_path, s.view_count, s.description, s.is_impact,
  (SELECT v.video_path FROM videos v WHERE v.id = s.mv_video_id) AS mv_path,
  (SELECT group_concat(sc.category_id) FROM song_categories sc WHERE sc.song_id = s.id) AS category_ids`

export const makeMusicRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const orderBy = (sort: SongFilter["sort"]) => {
    switch (sort) {
      case "newest":
        return sql.literal("ORDER BY s.year IS NULL, s.year DESC, s.release_date DESC, s.title")
      case "oldest":
        return sql.literal("ORDER BY s.year IS NULL, s.year ASC, s.release_date ASC, s.title")
      case "title":
        return sql.literal("ORDER BY s.title COLLATE NOCASE")
      default:
        return sql.literal("ORDER BY s.is_impact DESC, COALESCE(s.view_count, 0) DESC, s.title")
    }
  }

  const stats = Effect.gen(function* () {
    const [row] = yield* sql<{
      songs: number
      artists: number
      music_videos: number
      seconds: number | null
      awards_won: number
      first_year: number | null
      last_year: number | null
    }>`SELECT
        (SELECT count(*) FROM songs) AS songs,
        (SELECT count(DISTINCT artist_id) FROM song_artists) AS artists,
        (SELECT count(*) FROM songs s WHERE s.mv_video_id IS NOT NULL) AS music_videos,
        (SELECT sum(duration) FROM songs) AS seconds,
        (SELECT count(*) FROM awards WHERE result = 'won') AS awards_won,
        (SELECT min(year) FROM songs) AS first_year,
        (SELECT max(year) FROM songs) AS last_year`
    return {
      songs: row?.songs ?? 0,
      artists: row?.artists ?? 0,
      musicVideos: row?.music_videos ?? 0,
      hours: Math.round(((row?.seconds ?? 0) / 3600) * 10) / 10,
      awardsWon: row?.awards_won ?? 0,
      firstYear: row?.first_year ?? null,
      lastYear: row?.last_year ?? null,
    } satisfies ArchiveStats
  })

  const listGames = sql<{ id: string; name: string; short: string; color: string; song_count: number }>`
    SELECT g.id, g.name, g.short, g.color, (SELECT count(*) FROM songs s WHERE s.game_id = g.id) AS song_count
    FROM games g ORDER BY g.sort`.pipe(
    Effect.map((rows) =>
      rows.map((r): Game => ({ id: r.id, name: r.name, short: r.short, color: r.color, songCount: r.song_count })),
    ),
  )

  const listCategories = sql<{ id: string; name: string; description: string; song_count: number }>`
    SELECT c.id, c.name, c.description,
      (SELECT count(*) FROM song_categories sc WHERE sc.category_id = c.id) AS song_count
    FROM categories c ORDER BY c.sort`.pipe(
    Effect.map((rows) =>
      rows.map(
        (r): Category => ({ id: r.id, name: r.name, description: r.description, songCount: r.song_count }),
      ),
    ),
  )

  const listSongs = (filter: SongFilter = {}) =>
    Effect.gen(function* () {
      const where = []
      if (filter.q && filter.q.trim()) where.push(sql`s.search_text LIKE ${`%${filter.q.trim().toLowerCase()}%`}`)
      if (filter.game) where.push(sql`s.game_id = ${filter.game}`)
      if (filter.category)
        where.push(
          sql`EXISTS (SELECT 1 FROM song_categories sc2 WHERE sc2.song_id = s.id AND sc2.category_id = ${filter.category})`,
        )
      if (filter.artist)
        where.push(
          sql`EXISTS (SELECT 1 FROM song_artists sa2 WHERE sa2.song_id = s.id AND sa2.artist_id = ${filter.artist})`,
        )
      if (filter.year !== undefined) where.push(sql`s.year = ${filter.year}`)
      if (filter.hasVideo) where.push(sql`s.mv_video_id IS NOT NULL`)
      const whereClause = where.length > 0 ? sql`WHERE ${sql.and(where)}` : sql.literal("")
      const limit = Math.max(1, Math.min(filter.limit ?? 48, 1000))
      const offset = Math.max(0, filter.offset ?? 0)
      const [count] = yield* sql<{ total: number }>`SELECT count(*) AS total FROM songs s ${whereClause}`
      const rows = yield* sql<SongRow>`SELECT ${sql.literal(SONG_COLUMNS)} FROM songs s ${whereClause}
        ${orderBy(filter.sort)} LIMIT ${limit} OFFSET ${offset}`
      return { items: rows.map(toSummary), total: count?.total ?? 0 } satisfies Page<SongSummary>
    })

  const listSongIds = sql<{ id: string }>`SELECT id FROM songs ORDER BY id`.pipe(
    Effect.map((rows) => rows.map((r) => r.id)),
  )

  const getSongs = (ids: ReadonlyArray<string>) =>
    ids.length === 0
      ? Effect.succeed<ReadonlyArray<SongSummary>>([])
      : sql<SongRow>`SELECT ${sql.literal(SONG_COLUMNS)} FROM songs s WHERE ${sql.in("s.id", ids)}`.pipe(
          Effect.map((rows) => {
            const byId = new Map(rows.map((r) => [r.id, toSummary(r)]))
            return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
          }),
        )

  const getSong = (id: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<SongRow>`SELECT ${sql.literal(SONG_COLUMNS)} FROM songs s WHERE s.id = ${id}`
      if (!row) return null
      const artists = yield* sql<{ id: string; name: string; role: string }>`
        SELECT a.id, a.name, sa.role FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
        WHERE sa.song_id = ${id} ORDER BY sa.position`
      const videos = yield* sql<VideoRow>`
        SELECT id, title, kind, role, duration, upload_date, view_count, video_path, thumbnail_path
        FROM videos WHERE song_id = ${id}
        ORDER BY CASE role WHEN 'primary_mv' THEN 0 WHEN 'audio_source' THEN 1 ELSE 2 END, COALESCE(view_count, 0) DESC`
      const [analysis] = yield* sql<{ bpm: number | null }>`SELECT bpm FROM song_analysis WHERE song_id = ${id}`
      const [alignment] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM alignments WHERE song_id = ${id}`
      const refs = videos.map(toVideoRef)
      const musicVideo = row.mv_video_id ? (refs.find((v) => v.id === row.mv_video_id) ?? null) : null
      return {
        ...toSummary(row),
        album: row.album,
        releaseDate: row.release_date,
        description: row.description,
        audioKind: row.audio_kind as AudioKind | null,
        audioVideoId: row.audio_video_id,
        artists: artists.map((a) => ({ id: a.id, name: a.name, role: a.role as ArtistRole })),
        musicVideo,
        videos: refs.filter((v) => v.id !== musicVideo?.id),
        bpm: analysis?.bpm ?? null,
        hasAlignment: (alignment?.n ?? 0) > 0 && musicVideo?.videoUrl != null,
      } satisfies SongDetail
    })

  const relatedSongs = (id: string, limit = 8) =>
    sql<SongRow>`
      SELECT ${sql.literal(SONG_COLUMNS)},
        (SELECT count(*) FROM song_artists x JOIN song_artists y ON x.artist_id = y.artist_id
           WHERE x.song_id = s.id AND y.song_id = ${id}) * 3
        + (SELECT count(*) FROM song_categories x JOIN song_categories y ON x.category_id = y.category_id
           WHERE x.song_id = s.id AND y.song_id = ${id})
        + (s.game_id = (SELECT game_id FROM songs WHERE id = ${id})) AS affinity
      FROM songs s WHERE s.id != ${id}
      ORDER BY affinity DESC, COALESCE(s.view_count, 0) DESC LIMIT ${limit}`.pipe(
      Effect.map((rows) => rows.map(toSummary)),
    )

  const getAnalysis = (songId: string) =>
    sql<{
      bpm: number | null
      bpm_confidence: number | null
      beats: string
      peaks: string
      peaks_rate: number
      chorus_start: number | null
      chorus_end: number | null
    }>`SELECT bpm, bpm_confidence, beats, peaks, peaks_rate, chorus_start, chorus_end
       FROM song_analysis WHERE song_id = ${songId}`.pipe(
      Effect.map(([row]) =>
        row
          ? ({
              songId,
              bpm: row.bpm,
              bpmConfidence: row.bpm_confidence,
              beats: parseJson<ReadonlyArray<number>>(row.beats, []),
              peaks: row.peaks,
              peaksRate: row.peaks_rate,
              chorusStart: row.chorus_start,
              chorusEnd: row.chorus_end,
            } satisfies SongAnalysis)
          : null,
      ),
    )

  const getAlignment = (songId: string) =>
    sql<{
      video_id: string
      segments: string
      coverage: number
      confidence: number
      method: string
      song_duration: number
      video_duration: number
    }>`SELECT a.video_id, a.segments, a.coverage, a.confidence, a.method, a.song_duration, a.video_duration
       FROM alignments a JOIN songs s ON s.id = a.song_id AND s.mv_video_id = a.video_id
       WHERE a.song_id = ${songId}`.pipe(
      Effect.map(([row]) =>
        row
          ? ({
              songId,
              videoId: row.video_id,
              songDuration: row.song_duration,
              videoDuration: row.video_duration,
              segments: parseJson<ReadonlyArray<AlignmentSegment>>(row.segments, []),
              coverage: row.coverage,
              confidence: row.confidence,
              method: row.method,
            } satisfies Alignment)
          : null,
      ),
    )

  interface ArtistRow {
    id: string
    name: string
    kind: string
    bio: string | null
    image_url: string | null
    song_count: number
    game_ids: string | null
    cover_path: string | null
    palette: string | null
  }
  const ARTIST_SELECT = sql.literal(`
    SELECT a.id, a.name, a.kind, a.bio, a.image_url,
      (SELECT count(DISTINCT sa.song_id) FROM song_artists sa WHERE sa.artist_id = a.id) AS song_count,
      (SELECT group_concat(DISTINCT s.game_id) FROM song_artists sa JOIN songs s ON s.id = sa.song_id
         WHERE sa.artist_id = a.id) AS game_ids,
      (SELECT s.cover_path FROM song_artists sa JOIN songs s ON s.id = sa.song_id
         WHERE sa.artist_id = a.id AND s.cover_path IS NOT NULL
         ORDER BY COALESCE(s.view_count, 0) DESC LIMIT 1) AS cover_path,
      (SELECT s.palette FROM song_artists sa JOIN songs s ON s.id = sa.song_id
         WHERE sa.artist_id = a.id ORDER BY COALESCE(s.view_count, 0) DESC LIMIT 1) AS palette
    FROM artists a`)
  const toArtistSummary = (r: ArtistRow): ArtistSummary => ({
    id: r.id,
    name: r.name,
    kind: r.kind as ArtistKind,
    songCount: r.song_count,
    gameIds: r.game_ids ? r.game_ids.split(",") : [],
    coverUrl: mediaUrl(r.cover_path),
    palette: parseJson<ReadonlyArray<string>>(r.palette, []),
  })

  const listArtists = (options: { readonly q?: string | undefined; readonly kind?: ArtistKind | undefined } = {}) =>
    Effect.gen(function* () {
      const where = [sql`EXISTS (SELECT 1 FROM song_artists sa WHERE sa.artist_id = a.id)`]
      if (options.q && options.q.trim()) where.push(sql`lower(a.name) LIKE ${`%${options.q.trim().toLowerCase()}%`}`)
      if (options.kind) where.push(sql`a.kind = ${options.kind}`)
      const rows = yield* sql<ArtistRow>`${ARTIST_SELECT} WHERE ${sql.and(where)}
        ORDER BY song_count DESC, a.name COLLATE NOCASE`
      return rows.map(toArtistSummary)
    })

  const getArtist = (id: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<ArtistRow>`${ARTIST_SELECT} WHERE a.id = ${id}`
      if (!row) return null
      const songs = yield* sql<SongRow & { role: string }>`
        SELECT ${sql.literal(SONG_COLUMNS)}, sa.role FROM song_artists sa JOIN songs s ON s.id = sa.song_id
        WHERE sa.artist_id = ${id}
        ORDER BY s.year IS NULL, s.year DESC, COALESCE(s.view_count, 0) DESC`
      return {
        ...toArtistSummary(row),
        bio: row.bio,
        imageUrl: row.image_url,
        songs: songs.map((s) => ({ ...toSummary(s), role: s.role as ArtistRole })),
      } satisfies ArtistDetail
    })

  const listYears = sql<{ year: number; song_count: number }>`
    SELECT year, count(*) AS song_count FROM songs WHERE year IS NOT NULL GROUP BY year ORDER BY year DESC`.pipe(
    Effect.map((rows) => rows.map((r) => ({ year: r.year, songCount: r.song_count }))),
  )

  const listAwards = sql<{
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
  }>`SELECT * FROM awards ORDER BY year DESC, organization, award`.pipe(
    Effect.map((rows) =>
      rows.map(
        (r): Award => ({
          id: r.id,
          year: r.year,
          ceremony: r.ceremony,
          organization: r.organization,
          award: r.award,
          result: r.result === "won" ? "won" : "nominated",
          recipient: r.recipient,
          project: r.project,
          gameId: r.game_id,
          musicRelated: r.music_related === 1,
          songTitle: r.song_title,
          songId: r.song_id,
          sourceUrls: parseJson<ReadonlyArray<string>>(r.source_urls, []),
          notes: r.notes,
        }),
      ),
    ),
  )

  const listImpactStories = sql<{ data: string }>`SELECT data FROM impact_stories ORDER BY rank`.pipe(
    Effect.map((rows) => rows.map((r) => JSON.parse(r.data) as ImpactStory)),
  )

  const getImpactStory = (slug: string) =>
    sql<{ data: string }>`SELECT data FROM impact_stories WHERE slug = ${slug}`.pipe(
      Effect.map(([row]) => (row ? (JSON.parse(row.data) as ImpactStory) : null)),
    )

  return MusicRepo.of({
    stats,
    listGames,
    listCategories,
    listSongs,
    listSongIds,
    getSong,
    getSongs,
    relatedSongs,
    getAnalysis,
    getAlignment,
    listArtists,
    getArtist,
    listYears,
    listAwards,
    listImpactStories,
    getImpactStory,
  })
})

/** SQLite connection. Read-only for the websites; the pipeline opens it read-write. */
export const sqliteLayer = (options: { readonly readonly?: boolean; readonly filename?: string } = {}) =>
  SqliteClient.layer({
    filename: options.filename ?? databasePath(),
    readonly: options.readonly ?? false,
    disableWAL: options.readonly ?? false,
  })

export const MusicRepoLayer = Layer.effect(MusicRepo, makeMusicRepo)

/** Read-only repository over `data/riot-music.db` — what Next.js and Astro use. */
export const MusicRepoLive = MusicRepoLayer.pipe(Layer.provide(sqliteLayer({ readonly: true })))
