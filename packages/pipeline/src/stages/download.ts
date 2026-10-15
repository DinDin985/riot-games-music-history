import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect, Ref } from "effect"
import { paths } from "../paths.ts"
import { readListing, sources } from "../sources.ts"
import { type DownloadOutcome, Ytdlp, type YtdlpError } from "../services/Ytdlp.ts"

type Kind = "audio" | "video"

interface Progress {
  readonly done: number
  readonly downloaded: number
  readonly skipped: number
  readonly failed: number
}

const logLine = (kind: Kind, record: Record<string, unknown>) =>
  Effect.sync(() =>
    NodeFs.appendFileSync(
      NodePath.join(paths.logs, `download-${kind}.jsonl`),
      JSON.stringify({ ...record, at: new Date().toISOString() }) + "\n",
      "utf8",
    ),
  )

/**
 * Download a batch of YouTube ids with bounded concurrency. Failures are
 * logged to media/logs/download-<kind>.jsonl and never abort the batch, so the
 * stage can simply be re-run to pick up whatever is missing.
 */
export const downloadMany = (kind: Kind, ids: ReadonlyArray<string>, concurrency: number) =>
  Effect.gen(function* () {
    const ytdlp = yield* Ytdlp
    const unique = [...new Set(ids)]
    const progress = yield* Ref.make<Progress>({ done: 0, downloaded: 0, skipped: 0, failed: 0 })
    const fetch: (id: string) => Effect.Effect<DownloadOutcome, YtdlpError> =
      kind === "audio" ? ytdlp.downloadAudio : ytdlp.downloadVideo

    yield* Effect.logInfo(`Downloading ${unique.length} ${kind} items (concurrency ${concurrency})`)

    yield* Effect.forEach(
      unique,
      (id) =>
        fetch(id).pipe(
          Effect.tap((outcome) =>
            Ref.update(progress, (p) => ({
              ...p,
              downloaded: p.downloaded + (outcome === "downloaded" ? 1 : 0),
              skipped: p.skipped + (outcome === "skipped" ? 1 : 0),
            })),
          ),
          Effect.tap((outcome) => (outcome === "downloaded" ? logLine(kind, { id, ok: true }) : Effect.void)),
          Effect.catch((error) =>
            Ref.update(progress, (p) => ({ ...p, failed: p.failed + 1 })).pipe(
              Effect.andThen(
                logLine(kind, {
                  id,
                  ok: false,
                  error: "_tag" in error ? error._tag : "unknown",
                  detail: "output" in error ? String(error.output).slice(-600) : String(error),
                }),
              ),
              Effect.andThen(Effect.logWarning(`✗ ${kind} ${id} failed`)),
            ),
          ),
          Effect.andThen(Ref.updateAndGet(progress, (p) => ({ ...p, done: p.done + 1 }))),
          Effect.tap((p) =>
            p.done % 10 === 0 || p.done === unique.length
              ? Effect.logInfo(
                  `${kind}: ${p.done}/${unique.length} (new ${p.downloaded}, cached ${p.skipped}, failed ${p.failed})`,
                )
              : Effect.void,
          ),
        ),
      { concurrency, discard: true },
    )

    return yield* Ref.get(progress)
  })

/** Every official art track from the Topic channels. */
export const topicTrackIds = () =>
  sources.filter((s) => s.kind === "topic").flatMap((s) => readListing(s.key).map((e) => e.id))
