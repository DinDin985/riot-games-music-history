import { Effect, Option, Ref } from "effect"
import {
  commitTemp,
  describe,
  exists,
  ffmpeg,
  isFresh,
  probe,
  progressLogger,
  readCatalog,
  removeQuietly,
  seconds,
  tempPath,
} from "../analysis/media-io.ts"
import { audioFile, videoFile } from "../paths.ts"
import { Command } from "effect/cli"
import { concurrencyFlag, forceFlag } from "../workers/flags.ts"

export interface ExtractAudioOptions {
  readonly force: boolean
  readonly concurrency: number
}

/**
 * `extract-audio`: songs whose playable track is the music video itself
 * (`audio.kind === "music_video"`) get `media/audio/<id>.m4a` cut out of
 * `media/video/<id>.mp4`. AAC is stream-copied (bit-exact, instant); any other
 * codec is re-encoded to AAC 192k. `+faststart` keeps the m4a seekable over
 * HTTP Range requests from the first byte.
 */
export const extractAudio = (options: ExtractAudioOptions) =>
  Effect.gen(function* () {
    const catalog = yield* readCatalog
    if (Option.isNone(catalog)) {
      yield* Effect.logWarning("extract-audio: data/catalog.json not found — run `catalog` first; nothing to do")
      return { extracted: 0, upToDate: 0, missing: 0, failed: 0 }
    }
    const ids = [
      ...new Set(
        catalog.value.songs.flatMap((song) => (song.audio?.kind === "music_video" ? [song.audio.youtubeId] : [])),
      ),
    ]
    const started = Date.now()
    const stats = yield* Ref.make({ extracted: 0, upToDate: 0, missing: 0, failed: 0 })
    const tick = progressLogger("extract-audio", ids.length)
    yield* Effect.logInfo(`extract-audio: ${ids.length} songs use their music video's audio`)

    yield* Effect.forEach(
      ids,
      (id) =>
        Effect.gen(function* () {
          const source = videoFile(id)
          const target = audioFile(id)
          if (!exists(source)) {
            yield* Ref.update(stats, (s) => ({ ...s, missing: s.missing + 1 }))
            return
          }
          if (!options.force && isFresh(target, [source])) {
            yield* Ref.update(stats, (s) => ({ ...s, upToDate: s.upToDate + 1 }))
            return
          }
          const info = yield* probe(source)
          if (info.audioCodec === null) {
            yield* Effect.logWarning(`extract-audio ${id}: video has no audio stream`)
            yield* Ref.update(stats, (s) => ({ ...s, missing: s.missing + 1 }))
            return
          }
          const codec = info.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]
          const temp = tempPath(target)
          yield* ffmpeg(["-i", source, "-map", "0:a:0", "-vn", ...codec, "-movflags", "+faststart", temp]).pipe(
            Effect.tapError(() => Effect.sync(() => removeQuietly(temp))),
          )
          commitTemp(temp, target)
          yield* Ref.update(stats, (s) => ({ ...s, extracted: s.extracted + 1 }))
        }).pipe(
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`extract-audio ${id} failed: ${describe(error)}`)),
            ),
          ),
          Effect.andThen(tick()),
        ),
      { concurrency: options.concurrency, discard: true },
    )
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `extract-audio done in ${seconds(started)}: ${s.extracted} extracted, ${s.upToDate} up to date, ${s.missing} without video, ${s.failed} failed`,
    )
    return s
  })

export const extractAudioCommand = Command.make(
  "extract-audio",
  { force: forceFlag, concurrency: concurrencyFlag(4, "ffmpeg processes in parallel") },
  ({ force, concurrency }) => extractAudio({ force, concurrency }),
).pipe(Command.withDescription("Songs whose audio is their music video: media/video/<id>.mp4 → media/audio/<id>.m4a"))
