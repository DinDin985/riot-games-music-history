import * as NodeFs from "node:fs"
import { Context, Data, Effect, Layer, Schedule } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcessSpawner } from "effect/process"
import { audioFile, paths, videoFile } from "../paths.ts"
import * as Process from "./Process.ts"

export interface FlatEntry {
  readonly id: string
  readonly durationSeconds: number | null
  readonly title: string
}

export type DownloadOutcome = "downloaded" | "skipped"

/** YouTube answered with its "Sign in to confirm you're not a bot" wall — slow down. */
export class YoutubeThrottled extends Data.TaggedError("YoutubeThrottled")<{ readonly id: string }> {}

export type YtdlpError = Process.ProcessError | YoutubeThrottled | PlatformError

/**
 * yt-dlp fetches the YouTube streams; ffmpeg (found on PATH by yt-dlp) merges
 * video+audio, fixes containers and converts thumbnails.
 */
export class Ytdlp extends Context.Service<
  Ytdlp,
  {
    /** List every entry of a channel tab / playlist without resolving formats. */
    readonly flatList: (url: string) => Effect.Effect<ReadonlyArray<FlatEntry>, YtdlpError>
    /** Best AAC audio (itag 140 when available) → media/audio/<id>.m4a + info json + thumbnail. */
    readonly downloadAudio: (id: string) => Effect.Effect<DownloadOutcome, YtdlpError>
    /** ≤1080p H.264 + AAC merged to MP4 → media/video/<id>.mp4 + info json + thumbnail. */
    readonly downloadVideo: (id: string) => Effect.Effect<DownloadOutcome, YtdlpError>
  }
>()("pipeline/Ytdlp") {
  static readonly layer = Layer.effect(
    Ytdlp,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const provide = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)

      for (const dir of [paths.audio, paths.video, paths.meta, paths.thumbs, paths.logs]) {
        NodeFs.mkdirSync(dir, { recursive: true })
      }

      const common = [
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        // Be polite: YouTube's bot wall trips quickly on bursts of requests.
        "--sleep-requests",
        "1",
        "--sleep-interval",
        "2",
        "--max-sleep-interval",
        "6",
        "--write-info-json",
        "--write-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "-o",
        `infojson:${paths.meta}/%(id)s`,
        "-o",
        `thumbnail:${paths.thumbs}/%(id)s.%(ext)s`,
      ]

      // Transient failures: short exponential back-off. Bot wall: wait minutes, not seconds.
      const retryPolicy = Schedule.max([Schedule.exponential("2 seconds"), Schedule.recurs(3)])
      const throttlePolicy = Schedule.max([Schedule.exponential("90 seconds", 1.5), Schedule.recurs(5)])

      const isBotWall = (error: Process.ProcessError | PlatformError) =>
        error._tag === "ProcessError" && error.output.includes("confirm you") && error.output.includes("not a bot")

      // The default web clients hit the bot wall first; the embedded-player client usually
      // still serves full format lists. Try it first, then fall back for embed-disabled videos.
      const clientArgs: ReadonlyArray<ReadonlyArray<string>> = [
        ["--extractor-args", "youtube:player_client=web_embedded"],
        [],
      ]

      const resilient = (id: string, args: (client: ReadonlyArray<string>) => ReadonlyArray<string>) =>
        Process.run("yt-dlp", args(clientArgs[0]!)).pipe(
          Effect.catch(() => Process.run("yt-dlp", args(clientArgs[1]!))),
          Effect.mapError((error): YtdlpError => (isBotWall(error) ? new YoutubeThrottled({ id }) : error)),
          Effect.retry({ schedule: throttlePolicy, while: (error) => error._tag === "YoutubeThrottled" }),
          Effect.retry({ schedule: retryPolicy, while: (error) => error._tag !== "YoutubeThrottled" }),
        )

      const flatList = (url: string) =>
        Process.runStdout("yt-dlp", [
          "--flat-playlist",
          "--no-warnings",
          "--print",
          "%(id)s\t%(duration)s\t%(title)s",
          url,
        ]).pipe(
          Effect.map((stdout) =>
            stdout
              .split(/\r?\n/)
              .filter((line) => line.trim().length > 0)
              .map((line): FlatEntry => {
                const [id = "", duration = "NA", ...title] = line.split("\t")
                const seconds = Number(duration)
                return {
                  id,
                  durationSeconds: Number.isFinite(seconds) ? seconds : null,
                  title: title.join("\t"),
                }
              }),
          ),
          Effect.retry(retryPolicy),
          provide,
        )

      const downloadAudio = (id: string) =>
        NodeFs.existsSync(audioFile(id))
          ? Effect.succeed<DownloadOutcome>("skipped")
          : resilient(id, (client) => [
              ...client,
              ...common,
              "-f",
              "bestaudio[ext=m4a]/bestaudio",
              "-x",
              "--audio-format",
              "m4a",
              "-o",
              `${paths.audio}/%(id)s.%(ext)s`,
              `https://www.youtube.com/watch?v=${id}`,
            ]).pipe(Effect.as<DownloadOutcome>("downloaded"), provide)

      const downloadVideo = (id: string) =>
        NodeFs.existsSync(videoFile(id))
          ? Effect.succeed<DownloadOutcome>("skipped")
          : resilient(id, (client) => [
              ...client,
              ...common,
              "-S",
              "res:1080,vcodec:avc1,acodec:m4a",
              "-f",
              "bv*+ba/b",
              "--merge-output-format",
              "mp4",
              "-o",
              `${paths.video}/%(id)s.%(ext)s`,
              `https://www.youtube.com/watch?v=${id}`,
            ]).pipe(Effect.as<DownloadOutcome>("downloaded"), provide)

      return { flatList, downloadAudio, downloadVideo }
    }),
  )
}
