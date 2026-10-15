import * as NodePath from "node:path"
import { readJson } from "../analysis/media-io.ts"
import type { AudioAnalysisFile, Catalog } from "../catalog/types.ts"
import { paths } from "../paths.ts"
import type { SongForArtwork } from "./match.ts"

/** Catalog songs with the fields artwork matching needs (credits by name, analysed duration). */
export const songsForArtwork = (catalog: Catalog): ReadonlyArray<SongForArtwork> => {
  const names = new Map(catalog.artists.map((a) => [a.id, a.name]))
  return catalog.songs.map((song) => {
    const analysis = song.audio
      ? readJson<AudioAnalysisFile>(NodePath.join(paths.analysis, `${song.audio.youtubeId}.json`))
      : null
    return {
      id: song.id,
      title: song.title,
      artistNames: song.artists.map((a) => names.get(a.id) ?? a.id),
      duration: analysis?.duration ?? null,
      durationFromVideo: song.audio?.kind === "music_video",
      album: song.album,
    }
  })
}
