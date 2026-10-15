import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect } from "effect"
import { buildCatalog } from "../catalog/build.ts"
import { loadCatalogInputs, readJson } from "../catalog/inputs.ts"
import type { Catalog } from "../catalog/types.ts"
import { paths } from "../paths.ts"

export const catalogFile = NodePath.join(paths.data, "catalog.json")
export const listsDir = NodePath.join(paths.data, "lists")

/** Media the catalog references that is not on disk yet (input for the download stages). */
export const missingMedia = (catalog: Catalog) => {
  const videos = new Set<string>()
  const audio = new Set<string>()
  const has = (file: string) => NodeFs.existsSync(file)
  for (const song of catalog.songs) {
    if (song.musicVideo && !has(NodePath.join(paths.video, `${song.musicVideo.youtubeId}.mp4`)))
      videos.add(song.musicVideo.youtubeId)
    if (!song.audio) continue
    if (song.audio.kind === "music_video") {
      // The analysis stage extracts the track from the downloaded MV.
      if (!has(NodePath.join(paths.audio, `${song.audio.youtubeId}.m4a`)) && !has(NodePath.join(paths.video, `${song.audio.youtubeId}.mp4`)))
        videos.add(song.audio.youtubeId)
    } else if (!has(NodePath.join(paths.audio, `${song.audio.youtubeId}.m4a`))) {
      audio.add(song.audio.youtubeId)
    }
  }
  return { videos: [...videos].sort(), audio: [...audio].sort() }
}

const writeList = (file: string, header: string, ids: ReadonlyArray<string>) =>
  NodeFs.writeFileSync(file, [`# ${header}`, ...ids].join("\n") + "\n", "utf8")

const countBy = <A>(items: ReadonlyArray<A>, keys: (a: A) => ReadonlyArray<string>) => {
  const counts = new Map<string, number>()
  for (const item of items) for (const key of keys(item)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")
}

/**
 * `npm run pipeline -- catalog`: build `data/catalog.json` and the
 * `data/lists/{videos,audio}-needed.txt` download lists. Re-runnable; the file
 * is only rewritten (and `generatedAt` only changes) when the content changed.
 */
export const catalogStage = Effect.gen(function* () {
  const inputs = yield* Effect.sync(loadCatalogInputs)
  yield* Effect.logInfo(
    `Inputs: ${inputs.topicTracks.length} Topic tracks (${inputs.topicTracks.filter((t) => t.meta).length} with metadata), ` +
      `${inputs.videoClasses.length} classified videos (${inputs.videoMeta.size} with metadata), ` +
      `${inputs.wikiSongs.length} wiki songs, ${inputs.spotifyTracks.length} Spotify tracks, ${inputs.impact.length} impact files`,
  )

  // The previous catalog locks the ids of every song that is still there (see catalog/id-lock.ts).
  const previousJson = readJson(catalogFile)
  const previous =
    previousJson !== null && typeof previousJson === "object" && Array.isArray((previousJson as Catalog).songs)
      ? (previousJson as Catalog)
      : null
  const { catalog, stats } = buildCatalog(inputs, { previous })

  // Keep generatedAt stable when nothing changed, so re-runs produce no diff.
  const same =
    previous !== null &&
    JSON.stringify({ songs: previous.songs, artists: previous.artists }) ===
      JSON.stringify({ songs: catalog.songs, artists: catalog.artists })
  const output: Catalog = same ? { ...catalog, generatedAt: previous.generatedAt } : catalog
  yield* Effect.sync(() => {
    NodeFs.mkdirSync(listsDir, { recursive: true })
    if (!same) NodeFs.writeFileSync(catalogFile, JSON.stringify(output, null, 2) + "\n", "utf8")
  })

  const missing = missingMedia(output)
  yield* Effect.sync(() => {
    writeList(NodePath.join(listsDir, "videos-needed.txt"), "catalog videos without media/video/<id>.mp4", missing.videos)
    writeList(NodePath.join(listsDir, "audio-needed.txt"), "catalog audio without media/audio/<id>.m4a", missing.audio)
  })

  const songs = output.songs
  yield* Effect.logInfo(
    `Topic tracks ${stats.topicTracks} → ${stats.songsFromTopic} songs (${stats.topicDuplicatesMerged} duplicates merged); ` +
      `${stats.songsFromVideos} songs created from videos`,
  )
  yield* Effect.logInfo(
    `Videos: ${stats.videosLinked}/${stats.videosConsidered} linked, ${stats.videosUnmatched.length} unmatched`,
  )
  for (const line of stats.videosUnmatched) yield* Effect.logDebug(`unmatched video ${line}`)
  yield* Effect.logInfo(
    `Songs ${songs.length}, artists ${output.artists.length}, with music video ${songs.filter((s) => s.musicVideo).length}, ` +
      `audio ${countBy(songs, (s) => [s.audio?.kind ?? "none"])}`,
  )
  yield* Effect.logInfo(
    `Ids: ${stats.ids.kept} kept, ${stats.ids.fresh.length} new, ${stats.ids.changed.length} changed, ${stats.ids.dropped.length} dropped` +
      (stats.ids.changed.length > 0 ? ` — changed: ${stats.ids.changed.map((c) => `${c.from}→${c.to}`).join(", ")}` : "") +
      (stats.ids.dropped.length > 0 ? ` — dropped: ${stats.ids.dropped.join(", ")}` : ""),
  )
  for (const id of stats.ids.fresh) yield* Effect.logDebug(`new song ${id}`)
  if (previous) {
    const before = new Map<string, number>()
    for (const s of previous.songs) before.set(s.gameId, (before.get(s.gameId) ?? 0) + 1)
    const after = new Map<string, number>()
    for (const s of songs) after.set(s.gameId, (after.get(s.gameId) ?? 0) + 1)
    yield* Effect.logInfo(
      `Games (before → after): ${[...new Set([...after.keys(), ...before.keys()])]
        .sort((a, b) => (after.get(b) ?? 0) - (after.get(a) ?? 0))
        .map((g) => `${g} ${before.get(g) ?? 0}→${after.get(g) ?? 0}`)
        .join(", ")}`,
    )
  }
  yield* Effect.logInfo(`Games: ${countBy(songs, (s) => [s.gameId])}`)
  yield* Effect.logInfo(`Categories: ${countBy(songs, (s) => s.categoryIds)}`)
  yield* Effect.logInfo(`Primary categories: ${countBy(songs, (s) => [s.primaryCategoryId])}`)
  yield* Effect.logInfo(
    `Impact: ${songs.filter((s) => s.isImpact).map((s) => `${s.impactSlug}→${s.id}`).join(", ")}` +
      (stats.impactMissing.length > 0 ? ` (unmatched: ${stats.impactMissing.join(", ")})` : ""),
  )
  yield* Effect.logInfo(
    `${same ? "Unchanged" : "Wrote"} ${NodePath.relative(paths.root, catalogFile)}; ` +
      `needed: ${missing.videos.length} videos, ${missing.audio.length} audio`,
  )
  return output
})
