import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { readIdList } from "./sources.ts"
import { Ytdlp } from "./services/Ytdlp.ts"
import { downloadMany, topicTrackIds } from "./stages/download.ts"
import { enumerate } from "./stages/enumerate.ts"
import { buildDb } from "./stages/build-db.ts"
import { catalogStage } from "./stages/catalog.ts"
import { alignCommand } from "./stages/align.ts"
import { analyzeCommand } from "./stages/analyze.ts"
import { coversCommand } from "./stages/covers.ts"
import { extractAudioCommand } from "./stages/extract-audio.ts"
import { gifsCommand } from "./stages/gifs.ts"
import { soundcloudStage } from "./stages/soundcloud.ts"
import { artworkCommand } from "./stages/artwork.ts"
import { appleStage } from "./stages/apple.ts"
import { timelineCommand } from "./stages/timeline.ts"

const concurrency = (fallback: number) =>
  Flag.Int("concurrency").pipe(Flag.withDescription("Parallel downloads"), Flag.withDefault(fallback))

const listFlag = Flag.String("list").pipe(
  Flag.withDescription("File with one YouTube id per line (defaults to every Topic art track for audio)"),
  Flag.optional,
)

const enumerateCommand = Command.make("enumerate", {}, () => enumerate).pipe(
  Command.withDescription("Refresh data/sources/*.tsv from every configured channel and Topic playlist"),
)

const downloadAudioCommand = Command.make(
  "download-audio",
  { list: listFlag, concurrency: concurrency(2) },
  ({ list, concurrency }) =>
    downloadMany(
      "audio",
      Option.match(list, { onNone: topicTrackIds, onSome: readIdList }),
      concurrency,
    ),
).pipe(Command.withDescription("Download audio (m4a) for Topic art tracks or an id list"))

const downloadVideoCommand = Command.make(
  "download-video",
  { list: Flag.String("list").pipe(Flag.withDescription("File with one YouTube id per line")), concurrency: concurrency(2) },
  ({ list, concurrency }) => downloadMany("video", readIdList(list), concurrency),
).pipe(Command.withDescription("Download ≤1080p music videos (mp4) for an id list"))

const catalogCommand = Command.make("catalog", {}, () => catalogStage).pipe(
  Command.withDescription("Build data/catalog.json (songs, artists, linked videos) and data/lists/*-needed.txt"),
)

const buildDbCommand = Command.make("build-db", {}, () => buildDb).pipe(
  Command.withDescription("Recreate data/riot-music.db from data/catalog.json, curated research and media/analysis"),
)

const soundcloudCommand = Command.make("soundcloud", {}, () => soundcloudStage).pipe(
  Command.withDescription("Read soundcloud.com/leagueoflegends metadata (titles, albums, artwork URLs) → data/sources/soundcloud.jsonl"),
)

const appleCommand = Command.make("apple", {}, () => appleStage).pipe(
  Command.withDescription("Official album covers + track lists from Apple Music (Riot's artist pages) → data/sources/apple.jsonl"),
)

const pipeline = Command.make("pipeline").pipe(
  Command.withDescription("Riot Games music archive pipeline"),
  Command.withSubcommands([
    enumerateCommand,
    downloadAudioCommand,
    downloadVideoCommand,
    soundcloudCommand,
    appleCommand,
    catalogCommand,
    extractAudioCommand,
    analyzeCommand,
    coversCommand,
    artworkCommand,
    alignCommand,
    gifsCommand,
    buildDbCommand,
    timelineCommand,
  ]),
)

const MainLayer = Ytdlp.layer.pipe(Layer.provideMerge(NodeServices.layer))

Command.run(pipeline, { version: "0.1.0" }).pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
