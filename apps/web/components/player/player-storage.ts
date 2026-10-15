import type { SongSummary } from "@workspace/db/domain/types"
import { PLAYER_STORAGE_KEY, type PersistedPlayerState } from "@workspace/ui/lib/site-nav"

/**
 * localStorage persistence for the player (`PLAYER_STORAGE_KEY`), shared with
 * the Astro pages so a song keeps its place across the two frameworks.
 * Every access is guarded: storage can be unavailable (private mode, quota).
 */

export function readPersistedPlayer(): PersistedPlayerState | null {
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<PersistedPlayerState>
    if (typeof v.songId !== "string" || typeof v.audioUrl !== "string" || typeof v.title !== "string") return null
    return {
      songId: v.songId,
      title: v.title,
      displayArtist: typeof v.displayArtist === "string" ? v.displayArtist : "",
      audioUrl: v.audioUrl,
      coverUrl: typeof v.coverUrl === "string" ? v.coverUrl : null,
      palette: Array.isArray(v.palette) ? v.palette.filter((c): c is string => typeof c === "string") : [],
      time: typeof v.time === "number" && Number.isFinite(v.time) ? Math.max(0, v.time) : 0,
      volume: typeof v.volume === "number" && Number.isFinite(v.volume) ? Math.min(1, Math.max(0, v.volume)) : 0.8,
      queue: Array.isArray(v.queue) ? v.queue.filter((id): id is string => typeof id === "string") : [v.songId],
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    }
  } catch {
    return null
  }
}

export function writePersistedPlayer(state: PersistedPlayerState): void {
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or disabled — persistence is best effort.
  }
}

/** Minimal SongSummary from persisted data, used until the API returns the real one. */
export function songFromPersisted(p: PersistedPlayerState): SongSummary {
  return {
    id: p.songId,
    title: p.title,
    displayArtist: p.displayArtist,
    gameId: "",
    primaryCategoryId: "",
    categoryIds: [],
    year: null,
    duration: null,
    viewCount: null,
    isImpact: false,
    hasAudio: true,
    hasVideo: false,
    audioUrl: p.audioUrl,
    coverUrl: p.coverUrl,
    gifUrl: null,
    palette: p.palette,
  }
}
