import { Effect, Ref } from "effect"
import {
  analysisFile,
  decodePcm,
  describe,
  isFresh,
  listIds,
  progressLogger,
  seconds,
  writeJson,
} from "../analysis/media-io.ts"
import { RHYTHM_SAMPLE_RATE } from "../analysis/rhythm.ts"
import { audioFile, paths } from "../paths.ts"
import { AnalysisWorkers } from "../workers/pool.ts"
import { Command } from "effect/cli"
import { forceFlag, idListFlag, withWorkers, workersFlag } from "../workers/flags.ts"

export interface AnalyzeOptions {
  /** Re-analyse even when the output is newer than the audio. */
  readonly force: boolean
  /** Restrict to these YouTube ids (default: every media/audio/*.m4a). */
  readonly ids?: ReadonlyArray<string>
}

/**
 * `analyze`: every `media/audio/<id>.m4a` → `media/analysis/<id>.json`
 * (AudioAnalysisFile: BPM, beats, 50 Hz loudness envelope, chorus).
 *
 * ffmpeg decodes on the main thread (44.1 kHz mono f32); the PCM is handed to
 * the worker pool, where essentia.js runs RhythmExtractor2013, chroma and the
 * chorus finder. Decoding runs one step ahead of the workers so they never
 * wait. Up-to-date outputs are skipped; failures are logged and skipped.
 */
export const analyze = (options: AnalyzeOptions) =>
  Effect.gen(function* () {
    const workers = yield* AnalysisWorkers
    const all = options.ids ?? listIds(paths.audio, ".m4a")
    const todo = all.filter((id) => options.force || !isFresh(analysisFile(id), [audioFile(id)]))
    const started = Date.now()
    yield* Effect.logInfo(
      `analyze: ${all.length} audio files, ${all.length - todo.length} up to date, ${todo.length} to analyse`,
    )
    const stats = yield* Ref.make({ ok: 0, failed: 0, withChorus: 0, withBpm: 0 })
    const tick = progressLogger("analyze", todo.length)

    yield* Effect.forEach(
      todo,
      (id) =>
        Effect.gen(function* () {
          const pcm = yield* decodePcm(audioFile(id), RHYTHM_SAMPLE_RATE)
          const result = yield* workers.analyze(id, pcm)
          writeJson(analysisFile(id), result)
          yield* Ref.update(stats, (s) => ({
            ...s,
            ok: s.ok + 1,
            withChorus: s.withChorus + (result.chorus ? 1 : 0),
            withBpm: s.withBpm + (result.bpm ? 1 : 0),
          }))
        }).pipe(
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`analyze ${id} failed: ${describe(error)}`)),
            ),
          ),
          Effect.andThen(tick()),
        ),
      { concurrency: workers.size + 1, discard: true },
    )

    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `analyze done in ${seconds(started)}: ${s.ok} analysed (${s.withBpm} with BPM, ${s.withChorus} with chorus), ${s.failed} failed`,
    )
    return s
  })

export const analyzeCommand = Command.make(
  "analyze",
  { force: forceFlag, ids: idListFlag("ids", "Only these YouTube ids"), workers: workersFlag },
  ({ force, ids, workers }) => withWorkers(analyze({ force, ...(ids ? { ids } : {}) }), workers),
).pipe(
  Command.withDescription(
    "media/audio/*.m4a → media/analysis/<id>.json: BPM + beats (RhythmExtractor2013), loudness envelope, chorus",
  ),
)
