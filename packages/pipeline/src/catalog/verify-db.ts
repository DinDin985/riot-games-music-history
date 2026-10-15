/**
 * Smoke test of the built database through the same read-only `MusicRepo`
 * the websites use: `npx tsx packages/pipeline/src/catalog/verify-db.ts`.
 * Prints archive counts and the full records of the seven anchor impact songs.
 */
import { MusicRepo, MusicRepoLive } from "@workspace/db"
import { Effect } from "effect"

const IMPACT_SONGS = ["warriors", "enemy", "legends-never-die", "pop-stars", "awaken", "get-jinxed", "silver-scrapes"]

const program = Effect.gen(function* () {
  const repo = yield* MusicRepo
  const stats = yield* repo.stats
  console.log("stats", stats)
  const games = yield* repo.listGames
  console.log("songs per game:", games.map((g) => `${g.id} ${g.songCount}`).join(", "))
  const categories = yield* repo.listCategories
  console.log("songs per category:", categories.map((c) => `${c.id} ${c.songCount}`).join(", "))
  const artists = yield* repo.listArtists()
  console.log(
    `artists with songs: ${artists.length}; by kind:`,
    Object.entries(
      artists.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {}),
    )
      .map(([k, n]) => `${k} ${n}`)
      .join(", "),
  )
  const withVideo = yield* repo.listSongs({ hasVideo: true, limit: 1 })
  console.log(`songs with music video: ${withVideo.total} (downloaded MV: ${stats.musicVideos})`)
  const awards = yield* repo.listAwards
  const stories = yield* repo.listImpactStories
  console.log(`awards ${awards.length} (${awards.filter((a) => a.songId).length} linked); impact stories ${stories.length}`)

  for (const id of IMPACT_SONGS) {
    const song = yield* repo.getSong(id)
    if (!song) {
      console.log(`\n✗ ${id}: missing`)
      continue
    }
    const story = yield* repo.getImpactStory(id)
    console.log(`\n== ${song.id}: "${song.title}" — ${song.displayArtist}`)
    console.log(
      JSON.stringify(
        {
          artists: song.artists.map((a) => `${a.name} (${a.role})`),
          game: song.gameId,
          categories: song.categoryIds,
          primaryCategory: song.primaryCategoryId,
          year: song.year,
          releaseDate: song.releaseDate,
          album: song.album,
          duration: song.duration,
          views: song.viewCount,
          isImpact: song.isImpact,
          audio: { kind: song.audioKind, videoId: song.audioVideoId, url: song.audioUrl },
          cover: song.coverUrl,
          palette: song.palette,
          musicVideo: song.musicVideo
            ? { id: song.musicVideo.id, kind: song.musicVideo.kind, title: song.musicVideo.title, url: song.musicVideo.videoUrl }
            : null,
          otherVideos: song.videos.map((v) => `${v.id} ${v.role}/${v.kind}${v.videoUrl ? " (local)" : ""}`),
          bpm: song.bpm,
          hasAlignment: song.hasAlignment,
          impactStory: story ? `${story.slug} rank ${story.rank} songId=${story.songId}` : null,
        },
        null,
        2,
      ),
    )
  }
})

Effect.runPromise(program.pipe(Effect.provide(MusicRepoLive))).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
