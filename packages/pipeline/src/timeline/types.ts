import type { ArtistRole, VideoKind } from "@workspace/db/domain/types"

/**
 * Curated inputs of the `timeline` stage, all under `data/curated/timeline/`
 * (committed research). The stage tolerates missing files and unknown fields;
 * invalid ids/tags are reported and skipped, never fatal.
 *
 *   taxonomy.json              tags + discs (vinyls)            — TimelineTaxonomyFile
 *   research/<batch>.json      background research per song     — ResearchFile
 *   extras/<scope>.json        songs missing from catalog.json  — ExtrasFile
 *   associations/<batch>.json  game / tags / video / audio      — AssociationFile
 *
 * Dates are `yyyy-mm-dd`, `yyyy-mm` or `yyyy` (precision follows the format).
 */

export type Confidence = "high" | "medium" | "low"

export interface SourceRef {
  readonly title: string
  readonly url: string
}

export interface TimelineTaxonomyFile {
  readonly tags: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly kind: "event" | "group" | "format" | "series"
    readonly color: string
    readonly description: string
  }>
  readonly discs: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly short: string
    readonly kind: "all" | "game" | "collection"
    readonly color: string
    readonly description: string
    readonly gameIds: ReadonlyArray<string>
    readonly tags: ReadonlyArray<string>
  }>
}

/** `research/<batch>.json` — one entry per catalog song (or extra) researched. */
export interface ResearchFile {
  readonly batch: string
  readonly researchedAt: string
  readonly entries: ReadonlyArray<ResearchEntry>
}

export interface ResearchEntry {
  /** `data/catalog.json` song id (or an `x-…` extra id). */
  readonly songId: string
  /** First public release / premiere (earliest official upload, single release or in-game debut). */
  readonly date: string | null
  /** Short label, ≤ 60 chars: "Worlds 2014 anthem", "Season 2024 cinematic", "Sessions: Vi lo-fi track". */
  readonly usedFor: string | null
  /** 1–4 factual sentences: what the song is, who made it and what Riot made / used it for. */
  readonly background: string | null
  /** Official square album art when the local cover is wrong or missing (https URL), else null. */
  readonly coverUrl: string | null
  readonly spotifyUrl?: string | null
  readonly sources: ReadonlyArray<SourceRef>
  readonly confidence: Confidence
  readonly notes?: string
}

/** `extras/<scope>.json` — songs the timeline research found that `data/catalog.json` lacks. */
export interface ExtrasFile {
  /** e.g. "legends-of-runeterra", "teamfight-tactics", "virtual-groups". */
  readonly scope: string
  readonly researchedAt: string
  readonly entries: ReadonlyArray<ExtraEntry>
}

export interface ExtraEntry {
  /** `x-` + kebab-case slug of the title (plus artist/version on collisions); unique across all extras. */
  readonly id: string
  readonly title: string
  readonly artists: ReadonlyArray<{ readonly name: string; readonly role: ArtistRole }>
  /** Taxonomy game id (data/curated/taxonomy.json). */
  readonly gameId: string
  /** Taxonomy category ids. */
  readonly categoryIds: ReadonlyArray<string>
  /** Timeline tag ids (taxonomy.json here); categories are added automatically. */
  readonly tags: ReadonlyArray<string>
  readonly album: string | null
  readonly date: string
  readonly usedFor: string | null
  readonly background: string | null
  /** Official audio upload / art track on YouTube (becomes `media/audio/<id>.m4a` once downloaded). */
  readonly audioYoutubeId: string | null
  readonly musicVideoYoutubeId: string | null
  readonly musicVideoKind: VideoKind | null
  readonly musicVideoTitle?: string | null
  readonly spotifyUrl: string | null
  readonly coverUrl: string | null
  readonly sources: ReadonlyArray<SourceRef>
  readonly confidence: Confidence
  /** Set by the verifier once every id/URL was checked to exist and match the song. */
  readonly verified?: boolean
  readonly notes?: string
}

/** `associations/<batch>.json` — the final word on game, tags, music video and audio per song. */
export interface AssociationFile {
  readonly batch: string
  readonly associatedAt: string
  readonly entries: ReadonlyArray<AssociationEntry>
}

export interface AssociationEntry {
  /** Catalog song id or extra id. */
  readonly songId: string
  /** Corrected taxonomy game id, or null to keep the catalog's. */
  readonly gameId: string | null
  /** The complete tag list (taxonomy categories + timeline tags). Replaces the catalog categories. */
  readonly tags: ReadonlyArray<string>
  /** YouTube id of the music video to show; null = the song has none; absent = keep the catalog's. */
  readonly musicVideoYoutubeId?: string | null
  readonly musicVideoKind?: VideoKind | null
  /** YouTube id whose `media/audio/<id>.m4a` is the playable track; null = none; absent = keep the catalog's. */
  readonly audioYoutubeId?: string | null
  readonly notes?: string
}
