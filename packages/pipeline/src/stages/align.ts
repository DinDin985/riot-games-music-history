import { identityAlignment } from "@workspace/db/domain/alignment"
import { Effect, Option, Ref } from "effect"
import { ALIGN_SAMPLE_RATE } from "../analysis/features.ts"
import {
  alignFile,
  analysisFile,
  decodePcm,
  describe,
  exists,
  isFresh,
  probe,
  progressLogger,
  readCatalog,
  readJson,
  seconds,
  writeJson,
} from "../analysis/media-io.ts"
import type { AlignmentFile, AudioAnalysisFile, CatalogSong } from "../catalog/types.ts"
import { audioFile, videoFile } from "../paths.ts"
import type { AlignOutcome } from "../workers/protocol.ts"
import { AnalysisWorkers } from "../workers/pool.ts"
import { Command } from "effect/cli"
import { forceFlag, idListFlag, withWorkers, workersFlag } from "../workers/flags.ts"

export interface AlignOptions {
  readonly force: boolean
  /** Restrict to these song ids. */
  readonly songs?: ReadonlyArray<string>
}

interface Job {
  readonly song: CatalogSong
  readonly songId: string
  readonly audioId: string
  readonly videoId: string
  readonly identity: boolean
}

/** Songs whose playable audio was extracted from the music video itself play in lockstep with it. */
const isIdentity = (song: CatalogSong) =>
  song.audio !== null &&
  song.musicVideo !== null &&
  (song.audio.kind === "music_video" || song.audio.youtubeId === song.musicVideo.youtubeId)

/**
 * `align`: for every song with both a playable track and a downloaded music
 * video, match the two by AUDIO (analysis/align.ts — chroma diagonals, cut
 * detection, waveform/onset fine sync) and write
 * `media/analysis/align/<songId>__<videoId>.json`.
 *
 * Offsets are in the video's presentation time: the MP4's audio stream may
 * start later than its video stream, so decoded-audio time is shifted by
 * `audio start_time − video start_time` (ffprobe). Songs whose audio comes
 * from the video itself get an identity alignment without any analysis.
 */
export const align = (options: AlignOptions) =>
  Effect.gen(function* () {
    const catalog = yield* readCatalog
    if (Option.isNone(catalog)) {
      yield* Effect.logWarning("align: data/catalog.json not found — run `catalog` first; nothing to do")
      return { aligned: 0, identity: 0, upToDate: 0, missing: 0, failed: 0, empty: 0 }
    }
    const workers = yield* AnalysisWorkers
    const wanted = options.songs ? new Set(options.songs) : null
    const jobs: Job[] = catalog.value.songs.flatMap((song) =>
      song.audio && song.musicVideo && (!wanted || wanted.has(song.id))
        ? [
            {
              song,
              songId: song.id,
              audioId: song.audio.youtubeId,
              videoId: song.musicVideo.youtubeId,
              identity: isIdentity(song),
            },
          ]
        : [],
    )
    const started = Date.now()
    const stats = yield* Ref.make({ aligned: 0, identity: 0, upToDate: 0, missing: 0, failed: 0, empty: 0 })
    const tick = progressLogger("align", jobs.length)
    yield* Effect.logInfo(
      `align: ${jobs.length} songs with a music video (${jobs.filter((j) => j.identity).length} share the video's audio)`,
    )

    yield* Effect.forEach(
      jobs,
      (job) =>
        Effect.gen(function* () {
          const out = alignFile(job.songId, job.videoId)
          const video = videoFile(job.videoId)
          const audio = audioFile(job.audioId)
          if (!exists(video) || (!job.identity && !exists(audio))) {
            yield* Ref.update(stats, (s) => ({ ...s, missing: s.missing + 1 }))
            return
          }
          const inputs = job.identity ? [video] : [video, audio]
          if (!options.force && isFresh(out, inputs)) {
            yield* Ref.update(stats, (s) => ({ ...s, upToDate: s.upToDate + 1 }))
            return
          }
          const info = yield* probe(video)

          if (job.identity) {
            const analysed = readJson<AudioAnalysisFile>(analysisFile(job.audioId))
            const duration = analysed?.duration ?? info.duration ?? job.song.videos[0]?.durationSeconds ?? 0
            const file: AlignmentFile = identityAlignment(job.songId, job.videoId, duration)
            writeJson(out, file)
            yield* Ref.update(stats, (s) => ({ ...s, identity: s.identity + 1 }))
            return
          }

          const [songPcm, videoPcm] = yield* Effect.all(
            [decodePcm(audio, ALIGN_SAMPLE_RATE), decodePcm(video, ALIGN_SAMPLE_RATE)],
            { concurrency: 2 },
          )
          const outcome = yield* workers.align(songPcm, videoPcm)
          const shift = info.audioStart - (info.videoStart ?? 0)
          const file = toAlignmentFile(job, outcome, shift, info.duration)
          writeJson(out, file)
          yield* Ref.update(stats, (s) => ({
            ...s,
            aligned: s.aligned + 1,
            empty: s.empty + (file.segments.length === 0 ? 1 : 0),
          }))
          if (file.coverage < 0.5) {
            yield* Effect.logInfo(
              `align ${job.songId}: low coverage ${(file.coverage * 100).toFixed(0)}% (${file.segments.length} segments)`,
            )
          }
        }).pipe(
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`align ${job.songId} failed: ${describe(error)}`)),
            ),
          ),
          Effect.andThen(tick()),
        ),
      { concurrency: workers.size, discard: true },
    )
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `align done in ${seconds(started)}: ${s.aligned} aligned (${s.empty} without a match), ${s.identity} identity, ${s.upToDate} up to date, ${s.missing} missing media, ${s.failed} failed`,
    )
    return s
  })

const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Aligner output → AlignmentFile, shifted from decoded-audio time to video presentation time. */
export const toAlignmentFile = (
  job: Pick<Job, "songId" | "videoId">,
  outcome: AlignOutcome,
  shift: number,
  containerDuration: number | null,
): AlignmentFile => {
  const methods = [...new Set(outcome.refinement)]
  return {
    songId: job.songId,
    videoId: job.videoId,
    songDuration: round3(outcome.songDuration),
    videoDuration: round3(containerDuration ?? outcome.videoDuration + shift),
    segments: outcome.segments.map((s) => ({
      ...s,
      videoStart: round3(s.videoStart + shift),
      videoEnd: round3(s.videoEnd + shift),
      offset: round3(s.offset + shift),
    })),
    coverage: Math.round(outcome.coverage * 1000) / 1000,
    confidence: Math.round(outcome.confidence * 1000) / 1000,
    method: methods.length > 0 ? `audio:${methods.join("+")}` : "audio:none",
  }
}

export const alignCommand = Command.make(
  "align",
  { force: forceFlag, songs: idListFlag("songs", "Only these song ids"), workers: workersFlag },
  ({ force, songs, workers }) => withWorkers(align({ force, ...(songs ? { songs } : {}) }), workers),
).pipe(
  Command.withDescription("Match each song to its music video by audio → media/analysis/align/<song>__<video>.json"),
)
