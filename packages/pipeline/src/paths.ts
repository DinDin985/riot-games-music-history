import * as NodePath from "node:path"
import { fileURLToPath } from "node:url"

/** Absolute path of the monorepo root (…/riot-games-music-history). */
export const repoRoot = NodePath.resolve(
  NodePath.dirname(fileURLToPath(import.meta.url)),
  "../../..",
)

const at = (...segments: ReadonlyArray<string>) => NodePath.join(repoRoot, ...segments)

/**
 * Every on-disk location the pipeline reads or writes.
 *
 * - `data/` is committed: source listings, curated research, slim metadata.
 * - `media/` is git-ignored: downloaded audio/video and derived artefacts.
 */
export const paths = {
  root: repoRoot,
  data: at("data"),
  sources: at("data", "sources"),
  curated: at("data", "curated"),
  metadata: at("data", "metadata"),
  database: at("data", "riot-music.db"),
  media: at("media"),
  audio: at("media", "audio"),
  video: at("media", "video"),
  meta: at("media", "meta"),
  thumbs: at("media", "thumbs"),
  covers: at("media", "covers"),
  gifs: at("media", "gifs"),
  clips: at("media", "clips"),
  analysis: at("media", "analysis"),
  logs: at("media", "logs"),
} as const

export const audioFile = (youtubeId: string) => NodePath.join(paths.audio, `${youtubeId}.m4a`)
export const videoFile = (youtubeId: string) => NodePath.join(paths.video, `${youtubeId}.mp4`)
export const infoFile = (youtubeId: string) => NodePath.join(paths.meta, `${youtubeId}.info.json`)
