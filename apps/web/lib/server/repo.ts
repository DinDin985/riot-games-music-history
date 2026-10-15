import "server-only"

import * as NodeFs from "node:fs"
import { cache } from "react"
import { Effect, ManagedRuntime } from "effect"
import {
  MusicRepo,
  MusicRepoLive,
  databasePath,
  type ArtistKind,
  type MusicRepoShape,
  type SongFilter,
} from "@workspace/db"

/**
 * Server-side access to `data/riot-music.db` through the Effect `MusicRepo`.
 *
 * - `runRepo(repo => repo.listSongs(filter))` runs any repo effect and returns a Promise.
 * - The `get*` / `list*` helpers below are wrapped in React `cache()`, so several
 *   Server Components asking for the same data in one request hit SQLite once.
 * - When the database file does not exist yet, every call rejects with
 *   `DatabaseMissingError`. Pages should check `hasDatabase()` first and render
 *   `<DatabaseMissing />` (components/database-missing.tsx) instead of crashing.
 *
 * Connection lifecycle: the runtime (one read-only node:sqlite connection) is
 * created lazily, recreated when the DB file changes on disk (the pipeline
 * rebuilt it), and disposed after a short idle period. Windows refuses to
 * replace a file that is held open, so releasing the handle lets
 * `npm run pipeline -- build-db` run while the dev server is up.
 */

export class DatabaseMissingError extends Error {
  readonly _tag = "DatabaseMissingError"
  constructor(readonly path: string) {
    super(`The archive database was not found at ${path}. Run \`npm run pipeline -- build-db\`.`)
    this.name = "DatabaseMissingError"
  }
}

export const isDatabaseMissing = (error: unknown): error is DatabaseMissingError =>
  error instanceof DatabaseMissingError ||
  (typeof error === "object" && error !== null && (error as { _tag?: unknown })._tag === "DatabaseMissingError")

/** Whether `data/riot-music.db` (or `$RIOT_MUSIC_DB`) exists and is non-empty. */
export function hasDatabase(): boolean {
  return fileStamp() !== null
}

/** Absolute path of the database file (for messages). */
export function databaseLocation(): string {
  return databasePath()
}

// ---------------------------------------------------------------------------
// Runtime holder (kept on globalThis so dev-mode HMR does not leak connections)

type RepoRuntime = ManagedRuntime.ManagedRuntime<MusicRepo, unknown>

interface Holder {
  runtime: RepoRuntime | null
  stamp: string | null
  active: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

const IDLE_DISPOSE_MS = 15_000

const globalKey = Symbol.for("riot-music-archive.repo-runtime")
const holder: Holder = ((globalThis as Record<symbol, unknown>)[globalKey] as Holder | undefined) ??
  ((globalThis as Record<symbol, unknown>)[globalKey] = { runtime: null, stamp: null, active: 0, idleTimer: null } satisfies Holder)

function fileStamp(): string | null {
  try {
    const stat = NodeFs.statSync(databasePath())
    return stat.isFile() && stat.size > 0 ? `${stat.size}:${stat.mtimeMs}` : null
  } catch {
    return null
  }
}

function disposeRuntime() {
  const runtime = holder.runtime
  holder.runtime = null
  holder.stamp = null
  if (runtime) void runtime.dispose().catch(() => undefined)
}

function acquireRuntime(): RepoRuntime {
  const stamp = fileStamp()
  if (stamp === null) {
    if (holder.active === 0) disposeRuntime()
    throw new DatabaseMissingError(databasePath())
  }
  if (holder.idleTimer) {
    clearTimeout(holder.idleTimer)
    holder.idleTimer = null
  }
  // The pipeline rebuilt the file: reconnect once nothing is using the old connection.
  if (holder.runtime && holder.stamp !== stamp && holder.active === 0) disposeRuntime()
  if (!holder.runtime) {
    holder.runtime = ManagedRuntime.make(MusicRepoLive)
    holder.stamp = stamp
  }
  return holder.runtime
}

function releaseRuntime() {
  holder.active = Math.max(0, holder.active - 1)
  if (holder.active === 0 && holder.runtime) {
    if (holder.idleTimer) clearTimeout(holder.idleTimer)
    holder.idleTimer = setTimeout(() => {
      holder.idleTimer = null
      if (holder.active === 0) disposeRuntime()
    }, IDLE_DISPOSE_MS)
    holder.idleTimer.unref?.()
  }
}

/**
 * Run a `MusicRepo` effect. Rejects with `DatabaseMissingError` when there is
 * no database, or with the underlying `SqlError` on query failures.
 */
export async function runRepo<A, E>(f: (repo: MusicRepoShape) => Effect.Effect<A, E>): Promise<A> {
  const runtime = acquireRuntime()
  holder.active++
  try {
    return await runtime.runPromise(MusicRepo.use(f))
  } catch (error) {
    // A failed connection (or a DB caught mid-rebuild) must not be reused:
    // forget the stamp so the next call reconnects.
    if (holder.runtime === runtime) holder.stamp = null
    throw error
  } finally {
    releaseRuntime()
  }
}

// ---------------------------------------------------------------------------
// Request-deduplicated getters

/** Stable JSON key for object arguments (React cache() compares by identity). */
const keyOf = (value: object | undefined): string =>
  JSON.stringify(value ?? {}, Object.keys(value ?? {}).sort())

export const getStats = cache(() => runRepo((r) => r.stats))
export const getGames = cache(() => runRepo((r) => r.listGames))
export const getCategories = cache(() => runRepo((r) => r.listCategories))
export const getYears = cache(() => runRepo((r) => r.listYears))
export const getAwards = cache(() => runRepo((r) => r.listAwards))
export const getImpactStories = cache(() => runRepo((r) => r.listImpactStories))
export const getImpactStory = cache((slug: string) => runRepo((r) => r.getImpactStory(slug)))
export const getSong = cache((id: string) => runRepo((r) => r.getSong(id)))
export const getAnalysis = cache((songId: string) => runRepo((r) => r.getAnalysis(songId)))
export const getAlignment = cache((songId: string) => runRepo((r) => r.getAlignment(songId)))
export const getArtist = cache((id: string) => runRepo((r) => r.getArtist(id)))
export const getSongIds = cache(() => runRepo((r) => r.listSongIds))
export const getRelatedSongs = cache((id: string, limit: number = 8) => runRepo((r) => r.relatedSongs(id, limit)))

const listSongsByKey = cache((key: string) => runRepo((r) => r.listSongs(JSON.parse(key) as SongFilter)))
/** `repo.listSongs` with request-level dedupe. */
export const listSongs = (filter: SongFilter = {}) => listSongsByKey(keyOf(filter))

const getSongsByKey = cache((key: string) => runRepo((r) => r.getSongs(JSON.parse(key) as ReadonlyArray<string>)))
/** Summaries for `ids`, in the same order (unknown ids are skipped). */
export const getSongsByIds = (ids: ReadonlyArray<string>) => getSongsByKey(JSON.stringify(ids))

const listArtistsByKey = cache((key: string) =>
  runRepo((r) => r.listArtists(JSON.parse(key) as { q?: string; kind?: ArtistKind })),
)
export const listArtists = (options: { readonly q?: string | undefined; readonly kind?: ArtistKind | undefined } = {}) =>
  listArtistsByKey(keyOf(options))

/**
 * Await `promise`, but turn a missing database into `fallback` (other errors
 * still throw to the nearest error boundary). Handy for optional page sections.
 */
export async function orFallback<A>(promise: Promise<A>, fallback: A): Promise<A> {
  try {
    return await promise
  } catch (error) {
    if (isDatabaseMissing(error)) return fallback
    throw error
  }
}
