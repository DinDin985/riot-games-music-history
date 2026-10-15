import * as NodeFs from "node:fs"
import * as NodeOs from "node:os"
import * as NodePath from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { identityAlignment, songToVideo, videoToSong } from "../src/domain/alignment.ts"
import { MusicRepo, MusicRepoLayer, resetSchema, sqliteLayer } from "../src/index.ts"

const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "riot-music-db-"))
const DbLayer = sqliteLayer({ filename: NodePath.join(dir, "test.db") })
const TestLayer = Layer.merge(MusicRepoLayer.pipe(Layer.provide(DbLayer)), DbLayer)

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* resetSchema
  yield* sql`INSERT INTO games ${sql.insert([
    { id: "league-of-legends", name: "League of Legends", short: "LoL", color: "#C89B3C", sort: 0 },
    { id: "arcane", name: "Arcane", short: "Arcane", color: "#3FA7D6", sort: 1 },
  ])}`
  yield* sql`INSERT INTO categories ${sql.insert([
    { id: "worlds", name: "Worlds Songs", description: "", sort: 0 },
    { id: "arcane", name: "Arcane", description: "", sort: 1 },
  ])}`
  yield* sql`INSERT INTO artists ${sql.insert([
    { id: "against-the-current", name: "Against The Current", kind: "band" },
    { id: "imagine-dragons", name: "Imagine Dragons", kind: "band" },
  ])}`
  yield* sql`INSERT INTO songs ${sql.insert([
    {
      id: "legends-never-die",
      title: "Legends Never Die",
      display_artist: "Against The Current",
      game_id: "league-of-legends",
      primary_category_id: "worlds",
      year: 2017,
      duration: 235.1,
      audio_path: "audio/4Q46xYqUwZQ.m4a",
      audio_kind: "official_audio",
      mv_video_id: "r6zIGXun57U",
      palette: JSON.stringify(["#112233", "#445566"]),
      view_count: 100,
      is_impact: 1,
      search_text: "legends never die against the current",
    },
    {
      id: "enemy",
      title: "Enemy",
      display_artist: "Imagine Dragons & JID",
      game_id: "arcane",
      primary_category_id: "arcane",
      year: 2021,
      duration: 173,
      palette: "[]",
      view_count: 50,
      is_impact: 0,
      search_text: "enemy imagine dragons jid",
    },
  ])}`
  yield* sql`INSERT INTO song_categories ${sql.insert([
    { song_id: "legends-never-die", category_id: "worlds" },
    { song_id: "enemy", category_id: "arcane" },
  ])}`
  yield* sql`INSERT INTO song_artists ${sql.insert([
    { song_id: "legends-never-die", artist_id: "against-the-current", role: "primary", position: 0 },
    { song_id: "enemy", artist_id: "imagine-dragons", role: "primary", position: 0 },
  ])}`
  yield* sql`INSERT INTO videos ${sql.insert([
    {
      id: "r6zIGXun57U",
      song_id: "legends-never-die",
      source: "lol_videos",
      title: "Legends Never Die",
      kind: "music_video",
      role: "primary_mv",
      duration: 179,
      video_path: "video/r6zIGXun57U.mp4",
    },
  ])}`
  yield* sql`INSERT INTO alignments ${sql.insert({
    song_id: "legends-never-die",
    video_id: "r6zIGXun57U",
    segments: JSON.stringify([
      { songStart: 0, songEnd: 152.14, videoStart: 0.106, videoEnd: 152.24, offset: 0.106, score: 7.5 },
      { songStart: 206.94, songEnd: 229.78, videoStart: 152.19, videoEnd: 175.03, offset: -54.751, score: 4.8 },
    ]),
    coverage: 0.74,
    confidence: 0.83,
    method: "chroma+waveform",
    song_duration: 235.1,
    video_duration: 179,
  })}`
})

describe("MusicRepo", () => {
  it.effect("queries songs, filters, details and alignment", () =>
    Effect.gen(function* () {
      yield* seed
      const repo = yield* MusicRepo

      const all = yield* repo.listSongs({ sort: "popular" })
      expect(all.total).toBe(2)
      expect(all.items[0]!.id).toBe("legends-never-die")
      expect(all.items[0]!.hasVideo).toBe(true)
      expect(all.items[0]!.audioUrl).toBe("/media/audio/4Q46xYqUwZQ.m4a")
      expect(all.items[0]!.palette).toEqual(["#112233", "#445566"])

      const arcane = yield* repo.listSongs({ category: "arcane" })
      expect(arcane.items.map((s) => s.id)).toEqual(["enemy"])
      const search = yield* repo.listSongs({ q: "IMAGINE" })
      expect(search.total).toBe(1)

      const detail = yield* repo.getSong("legends-never-die")
      expect(detail?.musicVideo?.videoUrl).toBe("/media/video/r6zIGXun57U.mp4")
      expect(detail?.artists).toEqual([{ id: "against-the-current", name: "Against The Current", role: "primary" }])
      expect(detail?.hasAlignment).toBe(true)

      const alignment = yield* repo.getAlignment("legends-never-die")
      expect(alignment?.segments).toHaveLength(2)

      const artists = yield* repo.listArtists()
      expect(artists).toHaveLength(2)
      const stats = yield* repo.stats
      expect(stats.songs).toBe(2)
      expect(stats.musicVideos).toBe(1)
      expect((yield* repo.listGames).find((g) => g.id === "arcane")?.songCount).toBe(1)
    }).pipe(Effect.provide(TestLayer)),
  )
})

describe("alignment mapping", () => {
  const alignment = {
    songDuration: 235.1,
    videoDuration: 179,
    segments: [
      { songStart: 0, songEnd: 152.14, videoStart: 0.106, videoEnd: 152.24, offset: 0.106, score: 7.5 },
      { songStart: 206.94, songEnd: 229.78, videoStart: 152.19, videoEnd: 175.03, offset: -54.751, score: 4.8 },
    ],
  }

  it("maps song time inside a segment exactly", () => {
    expect(songToVideo(alignment, 60)).toEqual({ kind: "exact", videoTime: 60.106, segmentIndex: 0 })
  })

  it("snaps song time that was cut from the video to where the video resumes the song", () => {
    expect(songToVideo(alignment, 180)).toEqual({ kind: "snapped", videoTime: 152.19, segmentIndex: 1 })
  })

  it("maps video time back to song time across a cut", () => {
    const back = videoToSong(alignment, 160)
    expect(back.kind).toBe("exact")
    if (back.kind === "exact") expect(back.songTime).toBeCloseTo(214.751, 3)
  })

  it("reports video-only material (outro) with where the song would resume", () => {
    expect(videoToSong(alignment, 177).kind).toBe("video-only")
  })

  it("identity alignment maps 1:1", () => {
    const id = identityAlignment("x", "y", 100)
    expect(songToVideo(id, 42)).toEqual({ kind: "exact", videoTime: 42, segmentIndex: 0 })
  })
})
