import "server-only"

import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { findRepoRoot } from "@workspace/db/paths"
import {
  toTimelineEntry,
  type TimelineData,
  type TimelineEntryDetail,
  type TimelinePayload,
} from "@workspace/db/domain/timeline"

/**
 * Server-side access to `data/timeline.json` (built by `npm run pipeline -- timeline`).
 *
 * The file is parsed once and kept on `globalThis` (survives dev-mode HMR),
 * keyed by its size + mtime: a pipeline rebuild is picked up on the next
 * request without restarting the server. Concurrent first requests share one
 * read. When the file does not exist, the getters reject with
 * `TimelineMissingError`; check `hasTimeline()` first in pages.
 */

export class TimelineMissingError extends Error {
  readonly _tag = "TimelineMissingError"
  constructor(readonly path: string) {
    super(`The timeline has not been built yet (${path} is missing). Run \`npm run pipeline -- timeline\`.`)
    this.name = "TimelineMissingError"
  }
}

export const isTimelineMissing = (error: unknown): error is TimelineMissingError =>
  error instanceof TimelineMissingError ||
  (typeof error === "object" && error !== null && (error as { _tag?: unknown })._tag === "TimelineMissingError")

/** `RIOT_MUSIC_TIMELINE` overrides the default `data/timeline.json`. */
export function timelinePath(): string {
  return (
    process.env.RIOT_MUSIC_TIMELINE ?? NodePath.join(/*turbopackIgnore: true*/ findRepoRoot(), "data", "timeline.json")
  )
}

/** Whether `data/timeline.json` (or `$RIOT_MUSIC_TIMELINE`) exists and is non-empty. */
export function hasTimeline(): boolean {
  return fileStamp(timelinePath()) !== null
}

// ---------------------------------------------------------------------------
// Cache (kept on globalThis so dev-mode HMR does not re-parse on every edit)

interface Loaded {
  readonly stamp: string
  readonly payload: TimelinePayload
  readonly byId: ReadonlyMap<string, TimelineEntryDetail>
}

interface Holder {
  loaded: Loaded | null
  pending: { readonly stamp: string; readonly promise: Promise<Loaded> } | null
}

const globalKey = Symbol.for("riot-music-archive.timeline")
const holder: Holder =
  ((globalThis as Record<symbol, unknown>)[globalKey] as Holder | undefined) ??
  ((globalThis as Record<symbol, unknown>)[globalKey] = { loaded: null, pending: null } satisfies Holder)

function fileStamp(file: string): string | null {
  try {
    const stat = NodeFs.statSync(file)
    return stat.isFile() && stat.size > 0 ? `${stat.size}:${stat.mtimeMs}` : null
  } catch {
    return null
  }
}

function parseTimeline(text: string, file: string): TimelineData {
  const data = JSON.parse(text.replace(/^﻿/, "")) as Partial<TimelineData> | null
  if (
    data === null ||
    typeof data !== "object" ||
    !Array.isArray(data.entries) ||
    !Array.isArray(data.discs) ||
    !Array.isArray(data.tags)
  ) {
    throw new Error(`${file} is not a timeline file. Re-run \`npm run pipeline -- timeline\`.`)
  }
  return data as TimelineData
}

async function readTimeline(file: string, stamp: string): Promise<Loaded> {
  const data = parseTimeline(await NodeFs.promises.readFile(file, "utf8"), file)
  const loaded: Loaded = {
    stamp,
    payload: {
      generatedAt: data.generatedAt,
      entries: data.entries.map(toTimelineEntry),
      discs: data.discs,
      tags: data.tags,
    },
    byId: new Map(data.entries.map((entry) => [entry.id, entry])),
  }
  // Only cache what is still current (a rebuild may have landed while reading).
  if (fileStamp(file) === stamp) holder.loaded = loaded
  return loaded
}

async function loadTimeline(): Promise<Loaded> {
  const file = timelinePath()
  const stamp = fileStamp(file)
  if (stamp === null) {
    holder.loaded = null
    throw new TimelineMissingError(file)
  }
  if (holder.loaded?.stamp === stamp) return holder.loaded
  if (holder.pending?.stamp === stamp) return holder.pending.promise
  const promise = readTimeline(file, stamp)
  holder.pending = { stamp, promise }
  try {
    return await promise
  } finally {
    if (holder.pending?.promise === promise) holder.pending = null
  }
}

/** The page payload: every entry (slim), the discs and the tags. */
export async function getTimelinePayload(): Promise<TimelinePayload> {
  return (await loadTimeline()).payload
}

/** Everything the detail panel shows for one entry, or null when the id is unknown. */
export async function getTimelineEntry(id: string): Promise<TimelineEntryDetail | null> {
  return (await loadTimeline()).byId.get(id) ?? null
}
