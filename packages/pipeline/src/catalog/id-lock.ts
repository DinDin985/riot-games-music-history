import type { Catalog, CatalogSong } from "./types.ts"

/**
 * Song id lock. Song ids are public (URLs, `media/gifs/<id>.gif`,
 * `media/analysis/align/<id>__<video>.json`, research files keyed by slug), so
 * a re-run of the catalog must never rename an existing song just because new
 * inputs changed the slug order. A new song inherits the id of the previous
 * catalog's song that shares its playable audio, one of its Topic art tracks or
 * its music video; only genuinely new songs get fresh slugs, and those never
 * take an id an existing song already used.
 */

/** The media of a song in the build being assembled. */
export interface LockCandidate {
  /** Opaque, unique key of the song in the current build. */
  readonly key: number
  readonly audioId: string | null
  readonly topicIds: ReadonlyArray<string>
  readonly musicVideoId: string | null
}

export interface IdLockResult {
  /** New song key → the previous id it keeps. */
  readonly locked: ReadonlyMap<number, string>
  /** Every id of the previous catalog — fresh slugs must avoid all of them. */
  readonly reserved: ReadonlySet<string>
}

export interface IdLockReport {
  /** Songs that kept their previous id. */
  readonly kept: number
  /** Songs that matched no previous song and got a fresh slug. */
  readonly fresh: ReadonlyArray<string>
  /** Previous songs whose media now belongs to a song with another id (should stay empty). */
  readonly changed: ReadonlyArray<{ readonly from: string; readonly to: string }>
  /** Previous ids none of whose media is in the new catalog (removed or re-sourced songs). */
  readonly dropped: ReadonlyArray<string>
}

const TOPIC_SOURCE = /^topic_/

/** Topic art-track ids of a song of the previous catalog. */
export const topicIdsOf = (song: Pick<CatalogSong, "videos">): ReadonlyArray<string> =>
  song.videos.filter((v) => TOPIC_SOURCE.test(v.source)).map((v) => v.youtubeId)

const mediaOf = (song: CatalogSong): ReadonlySet<string> =>
  new Set([
    ...(song.audio ? [song.audio.youtubeId] : []),
    ...topicIdsOf(song),
    ...(song.musicVideo ? [song.musicVideo.youtubeId] : []),
  ])

const candidateMedia = (c: LockCandidate): ReadonlyArray<string> => [
  ...(c.audioId ? [c.audioId] : []),
  ...c.topicIds,
  ...(c.musicVideoId ? [c.musicVideoId] : []),
]

/**
 * Match the songs of a new build to the previous catalog. Strongest evidence
 * first — same audio source, then a shared Topic art track, then the same music
 * video, then any of those ids crossing roles (audio that used to be the MV) —
 * and within a tier in the given candidate order (pass the most important
 * songs first). Each previous id is inherited at most once.
 */
export const lockSongIds = (
  previous: Catalog | null | undefined,
  candidates: ReadonlyArray<LockCandidate>,
): IdLockResult => {
  const songs = previous?.songs ?? []
  const reserved = new Set(songs.map((s) => s.id))
  const index = (pick: (s: CatalogSong) => Iterable<string>) => {
    const out = new Map<string, Array<string>>()
    for (const song of songs)
      for (const id of new Set(pick(song))) {
        const list = out.get(id) ?? []
        list.push(song.id)
        out.set(id, list)
      }
    return out
  }
  const byAudio = index((s) => (s.audio ? [s.audio.youtubeId] : []))
  const byTopic = index(topicIdsOf)
  const byMv = index((s) => (s.musicVideo ? [s.musicVideo.youtubeId] : []))
  const byAny = index(mediaOf)

  const pairs: Array<{ readonly tier: number; readonly order: number; readonly key: number; readonly id: string }> = []
  candidates.forEach((c, order) => {
    const add = (tier: number, ids: ReadonlyArray<string> | undefined) => {
      for (const id of ids ?? []) pairs.push({ tier, order, key: c.key, id })
    }
    if (c.audioId) add(0, byAudio.get(c.audioId))
    for (const t of c.topicIds) add(1, byTopic.get(t))
    if (c.musicVideoId) add(2, byMv.get(c.musicVideoId))
    for (const m of candidateMedia(c)) add(3, byAny.get(m))
  })
  pairs.sort((a, b) => a.tier - b.tier || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const locked = new Map<number, string>()
  const taken = new Set<string>()
  for (const pair of pairs) {
    if (locked.has(pair.key) || taken.has(pair.id)) continue
    locked.set(pair.key, pair.id)
    taken.add(pair.id)
  }
  return { locked, reserved }
}

/** What the lock did, for the stage log (and the tests). */
export const idLockReport = (
  previous: Catalog | null | undefined,
  candidates: ReadonlyArray<LockCandidate>,
  lock: IdLockResult,
  finalIds: ReadonlyMap<number, string>,
): IdLockReport => {
  const songs = previous?.songs ?? []
  const kept = new Set(lock.locked.values())
  const owner = new Map<string, string>()
  for (const c of candidates) for (const m of candidateMedia(c)) if (!owner.has(m)) owner.set(m, finalIds.get(c.key) ?? "")
  const changed: Array<{ from: string; to: string }> = []
  const dropped: Array<string> = []
  for (const song of songs) {
    if (kept.has(song.id)) continue
    const to = [...mediaOf(song)].map((m) => owner.get(m)).find((id): id is string => !!id)
    if (to) changed.push({ from: song.id, to })
    else dropped.push(song.id)
  }
  return {
    kept: kept.size,
    fresh: candidates.filter((c) => !lock.locked.has(c.key)).map((c) => finalIds.get(c.key) ?? "").sort(),
    changed: changed.sort((a, b) => (a.from < b.from ? -1 : 1)),
    dropped: dropped.sort(),
  }
}
