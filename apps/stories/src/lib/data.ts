/**
 * Build-time data access for the story pages (server only — never import from an island).
 *
 * Primary source: `data/riot-music.db` through @workspace/db's `MusicRepo`.
 * Fallback: the curated research files (`data/curated/awards/*.json`,
 * `data/curated/impact/*.json`) read directly, so the pages build before the
 * catalog agent has produced the database. Curated entries that are not in the
 * database yet are merged in, so a rebuild picks up new research immediately.
 * Every input may be missing or partial; nothing here throws for absent files.
 */
import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { Effect } from "effect"
import {
  MusicRepo,
  MusicRepoLive,
  databasePath,
  findRepoRoot,
  mediaRoot,
  mediaUrl,
  youtubeThumbnail,
  youtubeUrl,
} from "@workspace/db"
import type { MusicRepoShape } from "@workspace/db"
import type { ArchiveStats, Award, ImpactStory, SongDetail } from "@workspace/db/domain/types"
import type { FeaturedMedia, GameInfo, MomentLink, StorySong, StoryView } from "./types.ts"

// ---------------------------------------------------------------------------
// File helpers

const repoRoot = findRepoRoot()
const curatedDir = (...parts: Array<string>) =>
  NodePath.join(process.env.STORIES_CURATED_DIR ?? NodePath.join(repoRoot, "data", "curated"), ...parts)

const readJson = <A>(file: string): A | null => {
  try {
    return JSON.parse(NodeFs.readFileSync(file, "utf8")) as A
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[stories] could not read ${file}: ${error}`)
    return null
  }
}

const listJsonFiles = (dir: string): Array<string> => {
  try {
    return NodeFs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => NodePath.join(dir, name))
  } catch {
    return []
  }
}

/** `/media/<rel>` when `media/<rel>` exists on disk, else null. */
export const mediaFile = (relativePath: string): string | null =>
  NodeFs.existsSync(NodePath.join(mediaRoot(), relativePath)) ? mediaUrl(relativePath) : null

/** Local thumbnail when downloaded, YouTube's otherwise. */
export const thumbnailUrl = (youtubeId: string): string =>
  mediaFile(`thumbs/${youtubeId}.jpg`) ?? youtubeThumbnail(youtubeId)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
const arr = (value: unknown): Array<unknown> => (Array.isArray(value) ? value : [])
const normTitle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")

// ---------------------------------------------------------------------------
// Taxonomy

interface Taxonomy {
  readonly games?: ReadonlyArray<GameInfo>
}

let gamesCache: ReadonlyMap<string, GameInfo> | undefined
export const games = (): ReadonlyMap<string, GameInfo> =>
  (gamesCache ??= new Map((readJson<Taxonomy>(curatedDir("taxonomy.json"))?.games ?? []).map((g) => [g.id, g])))

// ---------------------------------------------------------------------------
// Curated research files

const normalizeAward = (raw: unknown, file: string): Award | null => {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const year = num(raw.year)
  const result = raw.result === "won" ? "won" : raw.result === "nominated" ? "nominated" : null
  if (!id || year === null || !result) {
    console.warn(`[stories] skipping malformed award in ${NodePath.basename(file)}: ${JSON.stringify(raw).slice(0, 120)}`)
    return null
  }
  return {
    id,
    year,
    ceremony: str(raw.ceremony) ?? "",
    organization: str(raw.organization) ?? "",
    award: str(raw.award) ?? "",
    result,
    recipient: str(raw.recipient) ?? "",
    project: str(raw.project) ?? "Riot Games",
    // Research files use `game`; the database row type uses `gameId`.
    gameId: str(raw.gameId) ?? str(raw.game),
    musicRelated: raw.musicRelated === true,
    songTitle: str(raw.songTitle),
    songId: str(raw.songId),
    sourceUrls: arr(raw.sourceUrls).filter((u): u is string => typeof u === "string"),
    notes: str(raw.notes),
  }
}

const readCuratedAwards = (): Array<Award> => {
  const out: Array<Award> = []
  for (const file of listJsonFiles(curatedDir("awards"))) {
    const json = readJson<unknown>(file)
    const rows = Array.isArray(json) ? json : isRecord(json) ? arr(json.awards) : []
    for (const row of rows) {
      const award = normalizeAward(row, file)
      if (award) out.push(award)
    }
  }
  return out
}

/** Fill defaults so partially written research files still render. */
const normalizeStory = (raw: unknown, file?: string): ImpactStory | null => {
  if (!isRecord(raw)) return null
  const slug = str(raw.slug) ?? (file ? NodePath.basename(file, ".json") : null)
  const song = str(raw.song)
  if (!slug || !song) return null
  const clip = isRecord(raw.featuredClip) ? raw.featuredClip : null
  const clipStart = clip ? num(clip.start) : null
  const clipVideo = clip ? str(clip.youtubeId) : null
  return {
    slug,
    rank: num(raw.rank) ?? 999,
    song,
    songId: str(raw.songId),
    artists: arr(raw.artists).filter((a): a is string => typeof a === "string"),
    year: num(raw.year) ?? 0,
    game: str(raw.game) ?? "league-of-legends",
    categories: arr(raw.categories).filter((c): c is string => typeof c === "string"),
    tagline: str(raw.tagline) ?? "",
    headline: str(raw.headline) ?? "",
    summary: str(raw.summary) ?? "",
    story: arr(raw.story).flatMap((s) =>
      isRecord(s) && str(s.body) ? [{ heading: str(s.heading) ?? "", body: str(s.body) ?? "" }] : [],
    ),
    whyItMatters: arr(raw.whyItMatters).filter((w): w is string => typeof w === "string"),
    communityMoments: arr(raw.communityMoments).flatMap((m) =>
      isRecord(m) && str(m.title)
        ? [{ title: str(m.title) ?? "", description: str(m.description) ?? "", date: str(m.date), sourceUrl: str(m.sourceUrl) }]
        : [],
    ),
    stats: arr(raw.stats).flatMap((s) =>
      isRecord(s) && str(s.label) && (str(s.value) || num(s.value) !== null)
        ? [
            {
              label: str(s.label) ?? "",
              value: str(s.value) ?? String(num(s.value)),
              raw: num(s.raw),
              asOf: str(s.asOf) ?? "",
              sourceUrl: str(s.sourceUrl),
            },
          ]
        : [],
    ),
    videos: arr(raw.videos).flatMap((v) =>
      isRecord(v) && str(v.youtubeId)
        ? [
            {
              youtubeId: str(v.youtubeId) ?? "",
              title: str(v.title) ?? "",
              kind: str(v.kind) ?? "related",
              role: str(v.role) ?? "related",
            },
          ]
        : [],
    ),
    keyMoments: arr(raw.keyMoments).flatMap((k) =>
      isRecord(k) && str(k.youtubeId) && num(k.t) !== null
        ? [
            {
              youtubeId: str(k.youtubeId) ?? "",
              t: num(k.t) ?? 0,
              label: str(k.label) ?? "",
              description: str(k.description) ?? "",
            },
          ]
        : [],
    ),
    featuredClip:
      clip && clipVideo && clipStart !== null
        ? {
            youtubeId: clipVideo,
            start: clipStart,
            end: num(clip.end) ?? clipStart + 8,
            description: str(clip.description) ?? "",
            clipUrl: str(clip.clipUrl),
            gifUrl: str(clip.gifUrl),
          }
        : null,
    sources: arr(raw.sources).flatMap((s) =>
      isRecord(s) && str(s.url)
        ? [{ title: str(s.title) ?? str(s.url) ?? "", url: str(s.url) ?? "", publisher: str(s.publisher) ?? "" }]
        : [],
    ),
  }
}

const readCuratedStories = (): Array<ImpactStory> =>
  listJsonFiles(curatedDir("impact")).flatMap((file) => {
    const story = normalizeStory(readJson<unknown>(file), file)
    return story ? [story] : []
  })

// ---------------------------------------------------------------------------
// Pinned moments the user asked for explicitly

interface PinnedClip {
  readonly youtubeId: string
  /** The moment itself: the "Watch from m:ss" action starts here. */
  readonly at: number
  /** Loop window used when the research clip does not contain `at`. */
  readonly start: number
  readonly end: number
  readonly label: string
  readonly description: string
}

/**
 * Awaken must feature the Camille & Jhin scene at 3:07 of the Season 2019
 * cinematic, whatever the research file picked as its featured clip.
 */
const PINNED_CLIPS: Record<string, PinnedClip> = {
  awaken: {
    youtubeId: "zF5Ddo9JdpY",
    at: 187,
    start: 183,
    end: 190,
    label: "Camille & Jhin at 3:07",
    description: "Camille vaults over Jhin at center stage — the 3:07 shot of the Season 2019 cinematic.",
  },
}

/** Where the "Watch from m:ss" action of a story starts (the pinned moment, else the clip start). */
const watchStart = (story: ImpactStory): number | null =>
  PINNED_CLIPS[story.slug]?.at ?? story.featuredClip?.start ?? null

const applyPinnedClip = (story: ImpactStory): ImpactStory => {
  const pin = PINNED_CLIPS[story.slug]
  if (!pin) return story
  const current = story.featuredClip
  // Keep the researched clip when it already shows the pinned moment (its window/caption are hand-checked).
  const contains = current && current.youtubeId === pin.youtubeId && current.start <= pin.at && current.end >= pin.at
  const featuredClip = contains
    ? current
    : { youtubeId: pin.youtubeId, start: pin.start, end: pin.end, description: pin.description, clipUrl: null, gifUrl: null }
  if (story.keyMoments.some((m) => m.youtubeId === pin.youtubeId && Math.abs(m.t - pin.at) <= 1.5)) {
    return { ...story, featuredClip }
  }
  // Insert the pinned moment in time order among that video's moments (or append).
  const keyMoments = [...story.keyMoments]
  const moment = { youtubeId: pin.youtubeId, t: pin.at, label: pin.label, description: pin.description }
  const later = keyMoments.findIndex((m) => m.youtubeId === pin.youtubeId && m.t > pin.at)
  const lastSame = keyMoments.findLastIndex((m) => m.youtubeId === pin.youtubeId)
  keyMoments.splice(later >= 0 ? later : lastSame >= 0 ? lastSame + 1 : keyMoments.length, 0, moment)
  return { ...story, featuredClip, keyMoments }
}

// ---------------------------------------------------------------------------
// Song resolution without the database (catalog.json, then video classes)

interface CatalogSongLite {
  readonly id: string
  readonly title: string
  readonly displayArtist: string
  readonly year: number | null
  readonly audio: { readonly youtubeId: string } | null
  readonly musicVideo: { readonly youtubeId: string } | null
  readonly videos: ReadonlyArray<{ readonly youtubeId: string; readonly durationSeconds: number | null }>
  readonly coverYoutubeId: string | null
  readonly impactSlug?: string | null
}

interface VideoClassLite {
  readonly id: string
  readonly role?: string
  readonly topicTrackId?: string | null
  readonly durationSeconds?: number | null
}

let catalogCache: ReadonlyArray<CatalogSongLite> | undefined
const catalogSongs = (): ReadonlyArray<CatalogSongLite> =>
  (catalogCache ??= readJson<{ songs?: ReadonlyArray<CatalogSongLite> }>(NodePath.join(repoRoot, "data", "catalog.json"))
    ?.songs ?? [])

let classesCache: ReadonlyMap<string, VideoClassLite> | undefined
const videoClasses = (): ReadonlyMap<string, VideoClassLite> => {
  if (classesCache) return classesCache
  const map = new Map<string, VideoClassLite>()
  for (const file of listJsonFiles(curatedDir("video-classes"))) {
    const json = readJson<unknown>(file)
    const rows = Array.isArray(json) ? json : isRecord(json) ? (Object.values(json).find(Array.isArray) ?? []) : []
    for (const row of rows) if (isRecord(row) && typeof row.id === "string") map.set(row.id, row as unknown as VideoClassLite)
  }
  return (classesCache = map)
}

const metaDuration = (youtubeId: string): number | null =>
  num(readJson<{ duration?: unknown }>(NodePath.join(mediaRoot(), "meta", `${youtubeId}.info.json`))?.duration)

const paletteFor = (coverYoutubeId: string | null, game: GameInfo | null): ReadonlyArray<string> => {
  const file = coverYoutubeId
    ? readJson<{ colors?: ReadonlyArray<string> }>(
        NodePath.join(mediaRoot(), "analysis", "palette", `${coverYoutubeId}.json`),
      )
    : null
  if (file?.colors && file.colors.length > 0) return file.colors
  // No extracted palette yet: game colour over the archive navy.
  return [game?.color ?? "#C89B3C", "#0c1d2e", "#071320"]
}

const analysisFor = (audioYoutubeId: string | null) => {
  const file = audioYoutubeId
    ? readJson<{ peaks?: unknown; peaksRate?: unknown }>(NodePath.join(mediaRoot(), "analysis", `${audioYoutubeId}.json`))
    : null
  return { peaks: str(file?.peaks), peaksRate: num(file?.peaksRate) }
}

const primaryVideoIds = (story: ImpactStory): Array<string> => {
  const primary = story.videos.filter((v) => v.role === "primary_mv").map((v) => v.youtubeId)
  return primary.length > 0 ? primary : story.featuredClip ? [story.featuredClip.youtubeId] : []
}

const songFromFiles = (story: ImpactStory, game: GameInfo | null): StorySong => {
  const storyVideoIds = new Set(story.videos.map((v) => v.youtubeId))
  const primaryIds = primaryVideoIds(story)
  // 1. data/catalog.json (written by the catalog stage) knows the archive song id
  //    and marks impact songs with `impactSlug`.
  const candidates = catalogSongs().filter(
    (s) => s.impactSlug === story.slug || s.id === story.songId || normTitle(s.title) === normTitle(story.song),
  )
  const scored = candidates
    .map((s) => {
      let score = s.impactSlug === story.slug || s.id === story.songId ? 10 : 2
      if (s.musicVideo && primaryIds.includes(s.musicVideo.youtubeId)) score += 4
      if (s.videos.some((v) => storyVideoIds.has(v.youtubeId))) score += 1
      if (s.year === story.year) score += 1
      return { s, score }
    })
    .sort((a, b) => b.score - a.score)
  const catalogSong = scored[0] && scored[0].score >= 3 ? scored[0].s : null
  if (catalogSong) {
    const audioId = catalogSong.audio?.youtubeId ?? null
    const mvId = catalogSong.musicVideo?.youtubeId ?? null
    const cover = catalogSong.coverYoutubeId
    return {
      id: catalogSong.id,
      title: catalogSong.title,
      displayArtist: catalogSong.displayArtist,
      year: catalogSong.year,
      duration: audioId ? metaDuration(audioId) : null,
      audioUrl: (audioId ? mediaFile(`audio/${audioId}.m4a`) : null) ?? (mvId ? mediaFile(`video/${mvId}.mp4`) : null),
      coverUrl: cover ? (mediaFile(`covers/${cover}.jpg`) ?? mediaFile(`thumbs/${cover}.jpg`)) : null,
      gifUrl: mediaFile(`gifs/${catalogSong.id}.gif`),
      palette: paletteFor(cover, game),
      musicVideoId: mvId,
      ...analysisFor(audioId),
    }
  }
  // 2. Video classes: the primary MV's Topic art track, an audio-source upload, or the MV itself.
  const classes = videoClasses()
  const audioCandidates = [
    ...primaryIds.map((id) => classes.get(id)?.topicTrackId ?? null),
    ...story.videos.filter((v) => v.role === "audio_source").map((v) => v.youtubeId),
    ...primaryIds,
  ].filter((id): id is string => typeof id === "string" && id.length > 0)
  const audioId = audioCandidates.find((id) => mediaFile(`audio/${id}.m4a`)) ?? null
  const mvId = primaryIds.find((id) => classes.get(id)?.role === "primary_mv") ?? primaryIds[0] ?? null
  // Without an extracted track the MP4's AAC stream still plays in an <audio> element.
  const audioUrl = audioId ? mediaFile(`audio/${audioId}.m4a`) : mvId ? mediaFile(`video/${mvId}.mp4`) : null
  const coverId = audioId ?? mvId
  return {
    id: null,
    title: story.song,
    displayArtist: story.artists.join(", "),
    year: story.year || null,
    duration: audioId ? metaDuration(audioId) : mvId ? metaDuration(mvId) : null,
    audioUrl,
    coverUrl: coverId ? mediaFile(`thumbs/${coverId}.jpg`) : null,
    gifUrl: null,
    palette: paletteFor(coverId, game),
    musicVideoId: mvId,
    ...analysisFor(audioId),
  }
}

// ---------------------------------------------------------------------------
// Song resolution with the database

const resolveSongDetail = (repo: MusicRepoShape, story: ImpactStory) =>
  Effect.gen(function* () {
    const storyVideoIds = new Set(story.videos.map((v) => v.youtubeId))
    const primaryIds = new Set(primaryVideoIds(story))
    if (story.songId) {
      const detail = yield* repo.getSong(story.songId)
      if (detail) return detail
    }
    // Research files rarely know the archive id: match by title, then confirm with the linked videos.
    const page = yield* repo.listSongs({ q: story.song, limit: 25 })
    let best: SongDetail | null = null
    let bestScore = 0
    for (const candidate of page.items) {
      let score = normTitle(candidate.title) === normTitle(story.song) ? 2 : 0
      if (candidate.id === story.slug) score += 1
      if (candidate.year === story.year) score += 1
      if (score === 0) continue
      const detail = yield* repo.getSong(candidate.id)
      if (!detail) continue
      if (detail.musicVideo && primaryIds.has(detail.musicVideo.id)) score += 4
      else if (detail.musicVideo && storyVideoIds.has(detail.musicVideo.id)) score += 2
      if (detail.audioVideoId && storyVideoIds.has(detail.audioVideoId)) score += 2
      if (detail.videos.some((v) => storyVideoIds.has(v.id))) score += 1
      if (score > bestScore) {
        best = detail
        bestScore = score
      }
    }
    return bestScore >= 3 ? best : null
  })

const songFromDetail = (repo: MusicRepoShape, detail: SongDetail) =>
  Effect.gen(function* () {
    const analysis = yield* repo.getAnalysis(detail.id)
    return {
      id: detail.id,
      title: detail.title,
      displayArtist: detail.displayArtist,
      year: detail.year,
      duration: detail.duration,
      audioUrl: detail.audioUrl,
      coverUrl: detail.coverUrl,
      gifUrl: detail.gifUrl,
      palette: detail.palette.length > 0 ? detail.palette : ["#C89B3C", "#0c1d2e", "#071320"],
      musicVideoId: detail.musicVideo?.id ?? null,
      peaks: analysis?.peaks ?? null,
      peaksRate: analysis?.peaksRate ?? null,
    } satisfies StorySong
  })

// ---------------------------------------------------------------------------
// Links and featured media

const secondsParam = (t: number) => String(Math.round(t * 10) / 10)

/** Deep link into the Next.js song page when the moment is in the song's MV, else YouTube at `t`. */
export const momentLink = (song: StorySong, youtubeId: string, t: number): MomentLink => {
  const localVideoUrl = mediaFile(`video/${youtubeId}.mp4`)
  if (song.id && song.musicVideoId === youtubeId) {
    return {
      href: `/songs/${encodeURIComponent(song.id)}?vt=${secondsParam(t)}&watch=1`,
      external: false,
      localVideoUrl,
    }
  }
  return { href: youtubeUrl(youtubeId, t), external: true, localVideoUrl }
}

const featuredFor = (story: ImpactStory, song: StorySong): FeaturedMedia => {
  const clip = story.featuredClip
  const caption = clip?.description || null
  const poster = clip ? thumbnailUrl(clip.youtubeId) : song.coverUrl
  // 1. A clip rendered by the pipeline for this story.
  const clipVideo = clip?.clipUrl ?? mediaFile(`clips/${story.slug}.mp4`) ?? mediaFile(`clips/${story.slug}.webm`)
  if (clipVideo) return { kind: "video", src: clipVideo, poster, segment: null, caption, source: "clip" }
  const clipGif = clip?.gifUrl ?? mediaFile(`clips/${story.slug}.gif`)
  if (clipGif) return { kind: "image", src: clipGif, caption, source: "clip" }
  // 2. The exact featured moment, looped straight from the downloaded music video. This comes
  //    before the chorus GIF so pinned scenes (Awaken at 3:07) are always what the hero shows.
  const mv = clip ? mediaFile(`video/${clip.youtubeId}.mp4`) : null
  if (clip && mv) {
    return {
      kind: "video",
      src: mv,
      poster,
      segment: { start: clip.start, end: Math.max(clip.end, clip.start + 3) },
      caption,
      source: "music-video",
    }
  }
  // 3. The song's chorus GIF, 4. a palette backdrop.
  if (song.gifUrl) return { kind: "image", src: song.gifUrl, caption: null, source: "song-gif" }
  return { kind: "backdrop", poster, caption }
}

// ---------------------------------------------------------------------------
// Public API

export interface ArchiveData {
  readonly source: "database" | "curated"
  readonly awards: ReadonlyArray<Award>
  readonly stories: ReadonlyArray<StoryView>
  readonly stats: ArchiveStats | null
}

const mergeBy = <A>(primary: ReadonlyArray<A>, extra: ReadonlyArray<A>, key: (a: A) => string): Array<A> => {
  const seen = new Set(primary.map(key))
  return [...primary, ...extra.filter((a) => !seen.has(key(a)))]
}

const sortAwards = (awards: Array<Award>) =>
  awards.sort(
    (a, b) =>
      b.year - a.year ||
      a.organization.localeCompare(b.organization) ||
      a.award.localeCompare(b.award) ||
      a.recipient.localeCompare(b.recipient),
  )

const sortStories = (stories: Array<ImpactStory>) =>
  stories.sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug))

const toView = (story: ImpactStory, song: StorySong): StoryView => {
  const resolved = { ...story, songId: song.id ?? story.songId }
  const clip = resolved.featuredClip
  const start = watchStart(resolved)
  return {
    story: resolved,
    song,
    game: games().get(story.game) ?? null,
    featured: featuredFor(resolved, song),
    featuredWatch:
      clip && start !== null
        ? { ...momentLink(song, clip.youtubeId, start), start, youtubeId: clip.youtubeId }
        : null,
  }
}

const loadFromDatabase = (curatedAwards: Array<Award>, curatedStories: Array<ImpactStory>) =>
  Effect.gen(function* () {
    const repo = yield* MusicRepo
    const dbAwards = yield* repo.listAwards
    const dbStories = yield* repo.listImpactStories
    const stats = yield* repo.stats
    const awards = sortAwards(mergeBy(dbAwards, curatedAwards, (a) => a.id))
    const stories = sortStories(
      mergeBy(
        dbStories.flatMap((s) => {
          const story = normalizeStory(s)
          return story ? [story] : []
        }),
        curatedStories,
        (s) => s.slug,
      ),
    ).map(applyPinnedClip)
    const views = yield* Effect.forEach(stories, (story) =>
      Effect.gen(function* () {
        const game = games().get(story.game) ?? null
        const detail = yield* resolveSongDetail(repo, story)
        const song = detail ? yield* songFromDetail(repo, detail) : songFromFiles(story, game)
        return toView(story, song)
      }),
    )
    return { source: "database", awards, stories: views, stats } satisfies ArchiveData
  }).pipe(Effect.provide(MusicRepoLive))

const loadFromFiles = (curatedAwards: Array<Award>, curatedStories: Array<ImpactStory>): ArchiveData => ({
  source: "curated",
  awards: sortAwards([...curatedAwards]),
  stories: sortStories([...curatedStories])
    .map(applyPinnedClip)
    .map((story) => toView(story, songFromFiles(story, games().get(story.game) ?? null))),
  stats: null,
})

const load = async (): Promise<ArchiveData> => {
  const curatedAwards = readCuratedAwards()
  const curatedStories = readCuratedStories()
  const dbFile = databasePath()
  if (NodeFs.existsSync(dbFile) && process.env.STORIES_SKIP_DB !== "1") {
    try {
      const data = await Effect.runPromise(loadFromDatabase(curatedAwards, curatedStories))
      console.log(`[stories] ${data.awards.length} awards, ${data.stories.length} stories from ${dbFile}`)
      return data
    } catch (error) {
      console.warn(`[stories] database read failed, using curated files: ${error}`)
    }
  }
  const data = loadFromFiles(curatedAwards, curatedStories)
  console.log(`[stories] ${data.awards.length} awards, ${data.stories.length} stories from curated files`)
  return data
}

let archive: Promise<ArchiveData> | undefined
/** Loaded once per build and shared by every page. */
export const loadArchive = (): Promise<ArchiveData> => (archive ??= load())
