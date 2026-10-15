import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import type { TimelineData } from "@workspace/db/domain/timeline"
import { Data, Effect, Schedule } from "effect"
import { Command } from "effect/cli"
import { readJson } from "../catalog/inputs.ts"
import { paths } from "../paths.ts"
import { buildTimeline, type TimelineReport } from "../timeline/build.ts"
import { loadTimelineInputs } from "../timeline/inputs.ts"
import { catalogFile } from "./catalog.ts"

/**
 * `npm run pipeline -- timeline`: merge `data/catalog.json`, the curated
 * timeline research (`data/curated/timeline/{taxonomy.json,research,extras,associations}`)
 * and the local media into `data/timeline.json` (git-ignored, read by
 * `/api/timeline`), plus `media/logs/timeline-report.json`. Re-runnable at any
 * time: missing research only means fewer backgrounds. The file is rewritten
 * only when its content changed, so `generatedAt` stays stable across no-op runs.
 */

export const timelineFile = NodePath.join(paths.data, "timeline.json")
export const timelineReportFile = NodePath.join(paths.logs, "timeline-report.json")

export class TimelineError extends Data.TaggedError("TimelineError")<{ readonly message: string }> {}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** temp file + rename, retried briefly: Windows refuses to replace a file another process has open. */
const writeAtomic = (file: string, text: string) =>
  Effect.try({
    try: () => {
      NodeFs.mkdirSync(NodePath.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      NodeFs.writeFileSync(temp, text, "utf8")
      try {
        NodeFs.renameSync(temp, file)
      } catch (error) {
        NodeFs.rmSync(temp, { force: true })
        throw error
      }
    },
    catch: (error) =>
      new TimelineError({ message: `writing ${NodePath.relative(paths.root, file)}: ${describe(error)}` }),
  }).pipe(Effect.retry(Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(8)])))

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"

const list = (counts: Readonly<Record<string, number>>) =>
  Object.entries(counts)
    .map(([key, n]) => `${key} ${n}`)
    .join(", ") || "none"

const summary = (report: TimelineReport): ReadonlyArray<string> => {
  const t = report.totals
  const i = report.inputs
  const issues = [
    [report.unknownIds.length, "unknown song ids"],
    [report.unknownTags.length, "unknown tags"],
    [report.unknownGames.length, "unknown games"],
    [report.invalidDates.length, "invalid dates"],
    [report.duplicates.length, "duplicate extras"],
    [report.conflicts.length, "conflicts"],
    [report.droppedExtras.length, "dropped extras"],
    [report.excludedVideos.length, "excluded videos"],
    [report.taxonomy.categoriesWithoutTag.length, "categories without a tag"],
    [report.taxonomy.unknownDiscReferences.length, "unknown disc references"],
    [report.problems.length, "problems"],
  ] as const
  return [
    `${t.entries} entries (${t.archive} archive songs + ${t.extras} extras)`,
    `inputs: research ${i.research.entries} entries in ${i.research.files} files (${i.research.used} used), ` +
      `extras ${i.extras.entries} in ${i.extras.files} files (${i.extras.kept} kept), ` +
      `associations ${i.associations.entries} in ${i.associations.files} files (${i.associations.used} used)`,
    `dates: ${list(report.byDatePrecision)} precision; from ${list(report.byDateSource)}`,
    `background ${t.withBackground}/${t.entries}, audio ${t.withAudio}, music video ${t.withVideo} (${t.withLocalVideo} local), ` +
      `cover ${t.withCover} (${t.withLocalCover} local), palette ${t.withPalette}, duration ${t.withDuration}`,
    `games: ${list(report.byGame)}`,
    `discs: ${list(report.byDisc)}`,
    `issues: ${
      issues
        .filter(([n]) => n > 0)
        .map(([n, what]) => `${n} ${what}`)
        .join(", ") || "none"
    }`,
  ]
}

export const timelineStage = Effect.gen(function* () {
  const inputs = yield* Effect.try({
    try: () => loadTimelineInputs(catalogFile),
    catch: (error) => new TimelineError({ message: describe(error) }),
  })
  const built = buildTimeline(inputs)

  // Keep generatedAt (and the file) untouched when nothing changed.
  const previous = readJson(timelineFile) as TimelineData | null
  const same =
    previous !== null &&
    typeof previous === "object" &&
    JSON.stringify({ entries: previous.entries, discs: previous.discs, tags: previous.tags }) ===
      JSON.stringify({ entries: built.data.entries, discs: built.data.discs, tags: built.data.tags })
  const data: TimelineData = same ? { ...built.data, generatedAt: previous.generatedAt } : built.data
  if (!same) yield* writeAtomic(timelineFile, json(data))
  yield* writeAtomic(timelineReportFile, json(built.report))

  const report = built.report
  for (const problem of report.problems.slice(0, 20)) yield* Effect.logWarning(problem)
  if (report.problems.length > 20)
    yield* Effect.logWarning(`… ${report.problems.length - 20} more problems in the report`)
  for (const line of summary(report)) yield* Effect.logInfo(`timeline: ${line}`)
  yield* Effect.logInfo(
    `${same ? "Unchanged" : "Wrote"} ${NodePath.relative(paths.root, timelineFile)}; report → ${NodePath.relative(paths.root, timelineReportFile)}`,
  )
  return { data, report }
})

export const timelineCommand = Command.make("timeline", {}, () => timelineStage).pipe(
  Command.withDescription(
    "Build data/timeline.json for /timeline from data/catalog.json, data/curated/timeline/** and media (+ media/logs/timeline-report.json)",
  ),
)
