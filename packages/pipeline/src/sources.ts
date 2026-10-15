import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { paths } from "./paths.ts"
import type { FlatEntry } from "./services/Ytdlp.ts"

/**
 * The YouTube sources the user pointed us at.
 *
 * Three of the provided channel IDs are YouTube Music "Topic" channels (no
 * videos tab); their uploads live in the `UU…` playlist that mirrors the `UC…`
 * channel id. Those uploads are the official "art tracks" — the songs themselves.
 * Spotify (artist 47mIJdHORyRerp4os813jD) is DRM protected and is only used for
 * metadata during research, never for audio.
 */
export interface Source {
  readonly key: string
  readonly label: string
  readonly url: string
  /** `topic` = official audio art tracks; `channel` = videos (MVs, cinematics, …). */
  readonly kind: "topic" | "channel"
  readonly game: string | null
}

export const sources: ReadonlyArray<Source> = [
  {
    key: "topic_lol",
    label: "League Of Legends - Topic",
    url: "https://www.youtube.com/playlist?list=UUNQmUMv2OIDAfgIa1-ih0hA",
    kind: "topic",
    game: "league-of-legends",
  },
  {
    key: "topic_valorant",
    label: "VALORANT - Topic",
    url: "https://www.youtube.com/playlist?list=UUmZ3FM0vt0Ff3aAa2IstQTQ",
    kind: "topic",
    game: "valorant",
  },
  {
    key: "topic_2xko",
    label: "2XKO - Topic",
    url: "https://www.youtube.com/playlist?list=UUPiHUqFkbI111cM2PfjTE4w",
    kind: "topic",
    game: "2xko",
  },
  {
    // Auto-generated YouTube Music channel of the "Teamfight Tactics" Spotify/label artist
    // (REMIX RUMBLE OST, Set soundtracks…).
    key: "topic_tft",
    label: "Teamfight Tactics - Topic",
    url: "https://www.youtube.com/playlist?list=UUCt34taZbfBf2H4RA-Zg86w",
    kind: "topic",
    game: "teamfight-tactics",
  },
  {
    // A second auto-generated "Teamfight Tactics - Topic" channel (another distributor):
    // Inkborn Fables, K.O. Coliseum, Yuumi's Zoomieland…
    key: "topic_tft2",
    label: "Teamfight Tactics - Topic (2)",
    url: "https://www.youtube.com/playlist?list=UUjwA82vp67u9IhXL9ZMEQ4A",
    kind: "topic",
    game: "teamfight-tactics",
  },
  {
    key: "lol_videos",
    label: "League of Legends",
    url: "https://www.youtube.com/@leagueoflegends/videos",
    kind: "channel",
    game: "league-of-legends",
  },
  {
    key: "riotmusic",
    label: "Riot Games Music",
    url: "https://www.youtube.com/@riotgamesmusic/videos",
    kind: "channel",
    game: null,
  },
  {
    key: "valorant",
    label: "VALORANT",
    url: "https://www.youtube.com/@valorant/videos",
    kind: "channel",
    game: "valorant",
  },
  {
    // Official Teamfight Tactics channel (@playtft, UCiVO_mThS9B3tNc_kzpn-3g): set cinematics,
    // set-reveal trailers with original music, music videos.
    key: "tft",
    label: "Teamfight Tactics",
    url: "https://www.youtube.com/@playtft/videos",
    kind: "channel",
    game: "teamfight-tactics",
  },
]

export const sourceFile = (key: string) => NodePath.join(paths.sources, `${key}.tsv`)

export const writeListing = (key: string, entries: ReadonlyArray<FlatEntry>) =>
  NodeFs.writeFileSync(
    sourceFile(key),
    entries.map((e) => `${e.id}\t${e.durationSeconds ?? "NA"}\t${e.title}`).join("\n") + "\n",
    "utf8",
  )

export const readListing = (key: string): ReadonlyArray<FlatEntry> => {
  const file = sourceFile(key)
  if (!NodeFs.existsSync(file)) return []
  return NodeFs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [id = "", duration = "NA", ...title] = line.split("\t")
      const seconds = Number(duration)
      return { id, durationSeconds: Number.isFinite(seconds) ? seconds : null, title: title.join("\t") }
    })
}

/** Read a newline-separated list of YouTube ids (blank lines and `#` comments ignored). */
export const readIdList = (file: string): ReadonlyArray<string> =>
  NodeFs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0]!)
