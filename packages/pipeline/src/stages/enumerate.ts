import { Effect } from "effect"
import { sources, writeListing } from "../sources.ts"
import { Ytdlp } from "../services/Ytdlp.ts"

/** Refresh `data/sources/<key>.tsv` for every configured channel / Topic playlist. */
export const enumerate = Effect.gen(function* () {
  const ytdlp = yield* Ytdlp
  yield* Effect.forEach(
    sources,
    (source) =>
      ytdlp.flatList(source.url).pipe(
        Effect.tap((entries) => Effect.sync(() => writeListing(source.key, entries))),
        Effect.tap((entries) => Effect.logInfo(`${source.label}: ${entries.length} entries`)),
      ),
    { concurrency: 3, discard: true },
  )
})
