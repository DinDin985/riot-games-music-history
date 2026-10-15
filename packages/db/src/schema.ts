import { Effect } from "effect"
import { SqlClient } from "effect/sql"

/**
 * SQLite schema. The database is a build artefact of the pipeline
 * (`npm run pipeline -- build-db`): it is dropped and recreated from
 * `data/curated/*` + `media/analysis/*` on every build, so there are no
 * incremental migrations.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short TEXT NOT NULL,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    sort INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    bio TEXT,
    image_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    display_artist TEXT NOT NULL,
    game_id TEXT NOT NULL REFERENCES games(id),
    primary_category_id TEXT NOT NULL REFERENCES categories(id),
    album TEXT,
    year INTEGER,
    release_date TEXT,
    duration REAL,
    audio_video_id TEXT,
    audio_kind TEXT,
    audio_path TEXT,
    mv_video_id TEXT,
    cover_path TEXT,
    cover_key TEXT,
    palette TEXT NOT NULL DEFAULT '[]',
    gif_path TEXT,
    view_count INTEGER,
    description TEXT,
    is_impact INTEGER NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS songs_game ON songs(game_id)`,
  `CREATE INDEX IF NOT EXISTS songs_year ON songs(year)`,
  `CREATE TABLE IF NOT EXISTS song_categories (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    PRIMARY KEY (song_id, category_id)
  )`,
  `CREATE INDEX IF NOT EXISTS song_categories_category ON song_categories(category_id)`,
  `CREATE TABLE IF NOT EXISTS song_artists (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    artist_id TEXT NOT NULL REFERENCES artists(id),
    role TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (song_id, artist_id, role)
  )`,
  `CREATE INDEX IF NOT EXISTS song_artists_artist ON song_artists(artist_id)`,
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    duration REAL,
    upload_date TEXT,
    view_count INTEGER,
    video_path TEXT,
    thumbnail_path TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS videos_song ON videos(song_id)`,
  `CREATE TABLE IF NOT EXISTS song_analysis (
    song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    bpm REAL,
    bpm_confidence REAL,
    beats TEXT NOT NULL DEFAULT '[]',
    peaks TEXT NOT NULL DEFAULT '',
    peaks_rate REAL NOT NULL DEFAULT 0,
    chorus_start REAL,
    chorus_end REAL,
    analyzed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS alignments (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    segments TEXT NOT NULL,
    coverage REAL NOT NULL,
    confidence REAL NOT NULL,
    method TEXT NOT NULL,
    song_duration REAL NOT NULL,
    video_duration REAL NOT NULL,
    PRIMARY KEY (song_id, video_id)
  )`,
  `CREATE TABLE IF NOT EXISTS awards (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    ceremony TEXT NOT NULL,
    organization TEXT NOT NULL,
    award TEXT NOT NULL,
    result TEXT NOT NULL,
    recipient TEXT NOT NULL,
    project TEXT NOT NULL,
    game_id TEXT,
    music_related INTEGER NOT NULL,
    song_title TEXT,
    song_id TEXT,
    source_urls TEXT NOT NULL,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS impact_stories (
    slug TEXT PRIMARY KEY,
    rank INTEGER NOT NULL,
    song_id TEXT,
    data TEXT NOT NULL
  )`,
]

export const tables = [
  "impact_stories",
  "awards",
  "alignments",
  "song_analysis",
  "videos",
  "song_artists",
  "song_categories",
  "songs",
  "artists",
  "categories",
  "games",
] as const

/** Create every table (idempotent). */
export const createSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const statement of statements) yield* sql.unsafe(statement)
})

/** Drop and recreate every table — used by the pipeline's build-db stage. */
export const resetSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const table of tables) yield* sql.unsafe(`DROP TABLE IF EXISTS ${table}`)
  yield* createSchema
})
