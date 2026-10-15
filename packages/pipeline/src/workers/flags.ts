import { Effect, Option } from "effect"
import { Flag } from "effect/cli"
import { AnalysisWorkers, analysisWorkersLayer, defaultWorkerCount } from "./pool.ts"

/** CLI flags shared by the media analysis subcommands. */

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription("Redo outputs even when they are newer than their inputs"),
  Flag.withDefault(false),
)

/** Comma-separated id filter → `undefined` when absent. */
export const idListFlag = (name: string, description: string) =>
  Flag.String(name).pipe(
    Flag.withDescription(`${description} (comma-separated)`),
    Flag.optional,
    Flag.map(
      Option.match({
        onNone: () => undefined,
        onSome: (value: string) =>
          value
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
      }),
    ),
  )

export const workersFlag = Flag.Int("workers").pipe(
  Flag.withDescription("Worker threads for CPU analysis (default: min(16, cpus − 6), limited by free memory)"),
  Flag.optional,
)

export const concurrencyFlag = (fallback: number, description: string) =>
  Flag.Int("concurrency").pipe(Flag.withDescription(description), Flag.withDefault(fallback))

/** Run `effect` with an analysis worker pool of the requested (or default) size. */
export const withWorkers = <A, E, R>(effect: Effect.Effect<A, E, R>, workers: Option.Option<number>) =>
  effect.pipe(
    Effect.provide(analysisWorkersLayer(Math.max(1, Option.getOrElse(workers, defaultWorkerCount)))),
  ) as Effect.Effect<A, E, Exclude<R, AnalysisWorkers>>
