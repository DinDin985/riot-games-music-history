import { describe, expect, it } from "@effect/vitest"
import { toTimelineEntry, type TimelineEntryDetail } from "@workspace/db/domain/timeline"
import type { CatalogInputs } from "../src/catalog/inputs.ts"
import type { Catalog, CatalogSong, CatalogVideo } from "../src/catalog/types.ts"
import {
  backgroundFromDescription,
  buildTimeline,
  deriveTags,
  genericUsedFor,
  parseTimelineDate,
} from "../src/timeline/build.ts"
import {
  normalizeAssociation,
  normalizeExtra,
  type AssociationInput,
  type Sourced,
  type TimelineInputs,
  type TimelineMedia,
  type VideoClassInfo,
  type VideoInfo,
} from "../src/timeline/inputs.ts"
import type { ExtraEntry, ResearchEntry, TimelineTaxonomyFile } from "../src/timeline/types.ts"

// ---------------------------------------------------------------------------
// Fixtures

const taxonomy: CatalogInputs["taxonomy"] = {
  games: ["league-of-legends", "valorant", "legends-of-runeterra", "riot-games"].map((id) => ({
    id,
    name: id === "league-of-legends" ? "League of Legends" : id,
    short: id,
    color: "#888888",
  })),
  categories: [
    "worlds",
    "worlds-theme",
    "msi",
    "champion-theme",
    "cinematic",
    "virtual-group",
    "login-screen",
    "skin-line",
    "soundtrack",
    "esports",
    "remix",
    "arcane",
  ].map((id) => ({ id, name: id, description: "" })),
}

const tag = (id: string, kind: TimelineTaxonomyFile["tags"][number]["kind"] = "format") => ({
  id,
  name: id === "k-da" ? "K/DA" : id,
  kind,
  color: "#123456",
  description: "",
})

const timelineTaxonomy: TimelineTaxonomyFile = {
  // "arcane" is deliberately missing (reported as a category without a tag).
  tags: [
    ...["worlds", "worlds-theme", "msi", "esports", "all-stars"].map((id) => tag(id, "event")),
    ...["virtual-group", "k-da", "true-damage", "pentakill", "heartsteel", "seraphine"].map((id) => tag(id, "group")),
    ...["champion-theme", "cinematic", "login-screen", "soundtrack", "remix"].map((id) => tag(id)),
    ...["skin-line", "star-guardian", "sessions", "music-of-league"].map((id) => tag(id, "series")),
  ],
  discs: [
    { id: "all", name: "All", short: "ALL", kind: "all", color: "#000000", description: "", gameIds: [], tags: [] },
    {
      id: "lol",
      name: "LoL",
      short: "LoL",
      kind: "game",
      color: "#000000",
      description: "",
      gameIds: ["league-of-legends"],
      tags: [],
    },
    {
      id: "val",
      name: "VAL",
      short: "VAL",
      kind: "game",
      color: "#000000",
      description: "",
      gameIds: ["valorant"],
      tags: [],
    },
    {
      id: "lor",
      name: "LoR",
      short: "LoR",
      kind: "game",
      color: "#000000",
      description: "",
      gameIds: ["legends-of-runeterra"],
      tags: [],
    },
    {
      id: "empty",
      name: "Empty",
      short: "E",
      kind: "collection",
      color: "#000000",
      description: "",
      gameIds: [],
      tags: ["true-damage"],
    },
    {
      id: "worlds",
      name: "Worlds",
      short: "W",
      kind: "collection",
      color: "#000000",
      description: "",
      gameIds: [],
      tags: ["worlds", "worlds-theme"],
    },
    {
      id: "kda",
      name: "K/DA",
      short: "K/DA",
      kind: "collection",
      color: "#000000",
      description: "",
      gameIds: [],
      tags: ["k-da", "no-such-tag"],
    },
  ],
}

const video = (v: Partial<CatalogVideo> & Pick<CatalogVideo, "youtubeId" | "kind" | "role">): CatalogVideo => ({
  source: "lol_videos",
  title: `Video ${v.youtubeId}`,
  durationSeconds: 200,
  uploadDate: "2020-01-01",
  viewCount: 10,
  ...v,
})

const song = (s: Partial<CatalogSong> & Pick<CatalogSong, "id" | "title">): CatalogSong => ({
  displayArtist: "Riot Games Music",
  artists: [],
  gameId: "league-of-legends",
  primaryCategoryId: "soundtrack",
  categoryIds: ["soundtrack"],
  album: null,
  year: 2020,
  releaseDate: null,
  audio: null,
  musicVideo: null,
  videos: [],
  coverYoutubeId: null,
  viewCount: null,
  isImpact: false,
  impactSlug: null,
  description: null,
  ...s,
})

const catalog: Catalog = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  artists: [
    { id: "k-da", name: "K/DA", kind: "virtual-group" },
    { id: "madison-beer", name: "Madison Beer", kind: "artist" },
  ],
  songs: [
    song({
      id: "pop-stars",
      title: "POP/STARS",
      displayArtist: "K/DA ft. Madison Beer",
      artists: [
        { id: "k-da", role: "primary" },
        { id: "madison-beer", role: "featured" },
        { id: "k-da", role: "primary" },
      ],
      primaryCategoryId: "virtual-group",
      categoryIds: ["virtual-group", "skin-line"],
      year: 2018,
      releaseDate: "2018-11-03",
      audio: { youtubeId: "AUDIOpopst1", kind: "topic" },
      musicVideo: { youtubeId: "MVpopstars1", kind: "music_video" },
      videos: [
        video({
          youtubeId: "MVpopstars1",
          kind: "music_video",
          role: "primary_mv",
          title: "POP/STARS MV",
          uploadDate: "2018-11-03",
        }),
        video({
          youtubeId: "AUDIOpopst1",
          kind: "official_audio",
          role: "audio_source",
          uploadDate: "2025-08-01",
          durationSeconds: 191,
        }),
        video({ youtubeId: "LIVEpopsta1", kind: "live_performance", role: "related", title: "POP/STARS live" }),
      ],
      coverYoutubeId: "AUDIOpopst1",
      viewCount: 500,
      isImpact: true,
      description:
        "K/DA take the stage with their debut single. Watch it live at 8:00 a.m. PT on https://example.com/watch. Third sentence is dropped.",
    }),
    song({ id: "2014-world-championship-theme", title: "2014 World Championship Theme", year: 2014 }),
    song({
      id: "warriors",
      title: "Warriors",
      primaryCategoryId: "worlds",
      categoryIds: ["worlds"],
      releaseDate: "2014-09-22",
    }),
    song({
      id: "aurora-the-witch-between-worlds",
      title: "Aurora, the Witch Between Worlds",
      primaryCategoryId: "champion-theme",
      categoryIds: ["champion-theme"],
      releaseDate: "2024-07-20",
    }),
    song({ id: "27", title: "27", album: "Sessions: Diana", releaseDate: "2021-12-10", coverYoutubeId: "COVER27abcd" }),
    song({
      id: "jett-theme",
      title: "Jett Theme",
      gameId: "valorant",
      primaryCategoryId: "champion-theme",
      categoryIds: ["champion-theme"],
    }),
    song({
      id: "all-star-paris-2014",
      title: "All-Star Paris 2014",
      primaryCategoryId: "login-screen",
      categoryIds: ["login-screen", "esports"],
    }),
    song({
      id: "tagged-song",
      title: "Tagged Song",
      year: 2019,
      audio: { youtubeId: "OLDAUDIO123", kind: "topic" },
      musicVideo: { youtubeId: "OLDMVxxx123", kind: "music_video" },
      videos: [video({ youtubeId: "OLDMVxxx123", kind: "music_video", role: "primary_mv" })],
    }),
  ],
}

const research = (
  file: string,
  entry: Partial<ResearchEntry> & Pick<ResearchEntry, "songId">,
): Sourced<ResearchEntry> => ({
  file,
  entry: { date: null, usedFor: null, background: null, coverUrl: null, sources: [], confidence: "high", ...entry },
})

const association = (
  file: string,
  entry: Partial<AssociationInput> & Pick<AssociationInput, "songId">,
): Sourced<AssociationInput> => ({
  file,
  entry: { gameId: null, tags: null, ...entry },
})

const extra = (
  file: string,
  entry: Partial<ExtraEntry> & Pick<ExtraEntry, "id" | "title" | "gameId">,
): Sourced<ExtraEntry> => ({
  file,
  entry: {
    artists: [],
    categoryIds: ["soundtrack"],
    tags: [],
    album: null,
    date: "2020-06-01",
    usedFor: null,
    background: null,
    audioYoutubeId: null,
    musicVideoYoutubeId: null,
    musicVideoKind: null,
    spotifyUrl: null,
    coverUrl: null,
    sources: [],
    confidence: "high",
    ...entry,
  },
})

const fakeMedia = (
  files: ReadonlyArray<string>,
  palettes: Record<string, ReadonlyArray<string>> = {},
  durations: Record<string, number> = {},
  infos: Record<string, VideoInfo> = {},
): TimelineMedia => {
  const set = new Set(files)
  return {
    exists: (relative) => set.has(relative),
    palette: (key) => palettes[key] ?? null,
    analysisDuration: (id) => durations[id] ?? null,
    info: (id) => infos[id] ?? null,
  }
}

const media = fakeMedia(
  [
    "audio/AUDIOpopst1.m4a",
    "audio/NEWAUDIO123.m4a",
    "video/MVpopstars1.mp4",
    "thumbs/MVpopstars1.jpg",
    "covers/song-pop-stars.jpg",
    "covers/AUDIOpopst1.jpg",
    "covers/COVER27abcd.jpg",
  ],
  { "song-pop-stars": ["#ff00aa", "#000000"], AUDIOpopst1: ["#111111"], COVER27abcd: ["#272727"] },
  { AUDIOpopst1: 202.9426 },
  { XTRAMV00001: { title: "Extra MV from meta", uploadDate: "2020-06-02", duration: 180 } },
)

const videoClasses: ReadonlyMap<string, VideoClassInfo> = new Map([
  ["CLASSVID001", { title: "Jett Theme | VALORANT", kind: "champion_theme", role: "primary_mv" }],
  ["SKIPPEDVID1", { title: "Not music", kind: "not_music", role: "skip" }],
])

const inputs = (overrides: Partial<TimelineInputs> = {}): TimelineInputs => ({
  generatedAt: "2026-10-14T00:00:00.000Z",
  catalog,
  taxonomy,
  timelineTaxonomy,
  research: [],
  extras: [],
  associations: [],
  videoClasses,
  media,
  problems: [],
  files: { research: 0, extras: 0, associations: 0 },
  ...overrides,
})

const full = () =>
  buildTimeline(
    inputs({
      research: [
        research("research/a.json", {
          songId: "pop-stars",
          date: "2018-11-03",
          usedFor: "K/DA debut single",
          background: "Written in our own words.",
          coverUrl: "https://example.com/pop-stars.jpg",
          sources: [{ title: "Riot", url: "https://example.com/riot" }],
        }),
        research("research/a.json", { songId: "27", date: "2021-12", coverUrl: "https://example.com/27.jpg" }),
        research("research/a.json", { songId: "warriors", date: "2014-02-30" }),
        research("research/a.json", { songId: "no-such-song", date: "2020" }),
        research("research/b.json", { songId: "27", date: "2030-01-01" }),
        research("research/b.json", { songId: "x-lor-theme", background: "Research on an extra.", spotifyUrl: null }),
      ],
      associations: [
        association("associations/a.json", {
          songId: "tagged-song",
          gameId: "valorant",
          tags: ["k-da", "no-such-tag"],
          musicVideoYoutubeId: null,
          audioYoutubeId: "NEWAUDIO123",
        }),
        association("associations/a.json", {
          songId: "jett-theme",
          gameId: "fortnite",
          tags: ["champion-theme", "cinematic"],
          musicVideoYoutubeId: "CLASSVID001",
        }),
        association("associations/a.json", {
          songId: "aurora-the-witch-between-worlds",
          tags: null,
          musicVideoYoutubeId: "SKIPPEDVID1",
        }),
        association("associations/a.json", { songId: "x-lor-theme", tags: ["k-da", "soundtrack"] }),
        association("associations/b.json", { songId: "tagged-song", gameId: null, tags: [] }),
      ],
      extras: [
        extra("extras/a.json", {
          id: "x-lor-theme",
          title: "Legends of Runeterra Theme",
          gameId: "legends-of-runeterra",
          artists: [
            { name: "Madison Beer", role: "primary" },
            { name: "Someone New", role: "featured" },
          ],
          date: "2020-04-29",
          audioYoutubeId: "XTRAAUDIO01",
          musicVideoYoutubeId: "XTRAMV00001",
          verified: true,
        }),
        extra("extras/a.json", {
          id: "x-spotify-only",
          title: "Spotify Only",
          gameId: "league-of-legends",
          date: "2019",
          spotifyUrl: "https://open.spotify.com/track/abc",
          coverUrl: "https://example.com/cover.jpg",
        }),
        extra("extras/a.json", {
          id: "x-unverified",
          title: "Unverified",
          gameId: "league-of-legends",
          verified: false,
        }),
        extra("extras/a.json", { id: "bad-id", title: "Bad Id", gameId: "league-of-legends" }),
        extra("extras/a.json", {
          id: "x-pop-stars",
          title: "POP/STARS (feat. Madison Beer)",
          gameId: "league-of-legends",
        }),
        extra("extras/a.json", { id: "x-fortnite", title: "Elsewhere", gameId: "fortnite" }),
        extra("extras/a.json", { id: "x-you-are-my-legend", title: "You Are My Legend", gameId: "league-of-legends" }),
        extra("extras/b.json", { id: "x-lor-theme", title: "Another LoR Theme", gameId: "legends-of-runeterra" }),
      ],
    }),
  )

const byId = (entries: ReadonlyArray<TimelineEntryDetail>, id: string): TimelineEntryDetail => {
  const found = entries.find((e) => e.id === id)
  if (!found) throw new Error(`no entry ${id}`)
  return found
}

// ---------------------------------------------------------------------------
// Helpers

describe("parseTimelineDate", () => {
  it("parses day, month and year precision and pads", () => {
    expect(parseTimelineDate("2014-09-22")).toEqual({ date: "2014-09-22", precision: "day", year: 2014, month: 9 })
    expect(parseTimelineDate("2014-09")).toEqual({ date: "2014-09-01", precision: "month", year: 2014, month: 9 })
    expect(parseTimelineDate("2014")).toEqual({ date: "2014-01-01", precision: "year", year: 2014, month: 1 })
    expect(parseTimelineDate("20170915")?.date).toBe("2017-09-15")
    expect(parseTimelineDate("2024-02-29")?.precision).toBe("day")
  })

  it("rejects impossible dates", () => {
    for (const bad of ["2023-02-29", "2014-13", "2014-00-10", "2014-04-31", "0214-05-01", "May 2014", "", null]) {
      expect(parseTimelineDate(bad)).toBeNull()
    }
  })
})

describe("deriveTags", () => {
  const derive = (title: string, extra: Partial<Parameters<typeof deriveTags>[0]> = {}) =>
    deriveTags({ title, album: null, artistNames: [], categoryIds: ["soundtrack"], ...extra })

  it("adds virtual-group tags from the credits", () => {
    expect(derive("MORE", { artistNames: ["K/DA", "Seraphine"] })).toEqual([
      "soundtrack",
      "k-da",
      "virtual-group",
      "seraphine",
    ])
    expect(derive("GIANTS", { artistNames: ["true damage"] })).toContain("true-damage")
  })

  it("adds series and event tags from the title and album", () => {
    expect(derive("27", { album: "Sessions: Diana" })).toContain("sessions")
    expect(derive("A New Dawn", { album: "The Music of League of Legends: Season 4" })).toContain("music-of-league")
    expect(derive("Dream Eater", { album: "Sessions: Star Guardian Taliyah" })).toEqual(
      expect.arrayContaining(["sessions", "star-guardian", "skin-line"]),
    )
    expect(derive("All-Star Paris 2014")).toContain("all-stars")
    expect(derive("2016 MSI Theme")).toContain("msi")
  })

  it("splits Worlds anthems from Worlds orchestral themes and respects the catalog", () => {
    expect(derive("2014 World Championship Theme")).toEqual(["soundtrack", "worlds-theme"])
    expect(derive("Eyes on Worlds - 2017")).toEqual(["soundtrack", "worlds"])
    expect(derive("2019 World Championship Theme", { categoryIds: ["worlds"] })).toEqual(["worlds"])
    expect(derive("Worlds Collide", { categoryIds: ["worlds-theme"] })).toEqual(["worlds-theme"])
    expect(derive("Aurora, the Witch Between Worlds")).toEqual(["soundtrack"])
  })
})

describe("text fallbacks", () => {
  it("keeps the first two sentences of a description, without links", () => {
    expect(
      backgroundFromDescription("First one. Then at 8:00 a.m. PT go to https://example.com/x now! Third. Fourth."),
    ).toBe("First one. Then at 8:00 a.m. PT go to now!")
    expect(backgroundFromDescription(null)).toBeNull()
    const long = backgroundFromDescription(`${"word ".repeat(100)}end.`)!
    expect(long.length).toBeLessThanOrEqual(320)
    expect(long.endsWith("…")).toBe(true)
  })

  it("labels what a song was for", () => {
    const ctx = {
      gameNames: new Map([["league-of-legends", "League of Legends"]]),
      tagNames: new Map([["k-da", "K/DA"]]),
    }
    const label = (
      primaryCategoryId: string,
      extra: { album?: string | null; gameId?: string; tags?: ReadonlyArray<string> } = {},
    ) =>
      genericUsedFor({
        title: "Song",
        album: null,
        gameId: "league-of-legends",
        tags: [],
        primaryCategoryId,
        ...ctx,
        ...extra,
      })
    expect(label("login-screen")).toBe("Login screen")
    expect(label("champion-theme", { gameId: "valorant" })).toBe("Agent theme")
    expect(label("soundtrack", { album: "Sessions: Vi" })).toBe("Track from Sessions: Vi")
    expect(label("soundtrack", { album: "Song" })).toBe("League of Legends soundtrack")
    expect(label("virtual-group", { tags: ["k-da"] })).toBe("K/DA song")
  })
})

describe("normalizers", () => {
  it("keeps the three-way video/audio rule of associations", () => {
    const problems: Array<string> = []
    const absent = normalizeAssociation({ songId: "a", gameId: null, tags: ["k-da"] }, "x#0", problems)!
    expect("musicVideoYoutubeId" in absent).toBe(false)
    expect(absent.tags).toEqual(["k-da"])
    const none = normalizeAssociation(
      { songId: "a", musicVideoYoutubeId: null, audioYoutubeId: "dQw4w9WgXcQ" },
      "x#1",
      problems,
    )!
    expect(none.musicVideoYoutubeId).toBeNull()
    expect(none.audioYoutubeId).toBe("dQw4w9WgXcQ")
    expect(none.tags).toBeNull()
    const invalid = normalizeAssociation({ songId: "a", musicVideoYoutubeId: "not an id" }, "x#2", problems)!
    expect("musicVideoYoutubeId" in invalid).toBe(false)
    expect(problems).toHaveLength(1)
    expect(normalizeAssociation({ tags: [] }, "x#3", problems)).toBeNull()
  })

  it("fills defaults for partial extras", () => {
    const problems: Array<string> = []
    const entry = normalizeExtra(
      { id: "x-a", title: "A", artists: ["Someone", { name: "B", role: "nope" }] },
      "x#0",
      problems,
    )!
    expect(entry.artists).toEqual([
      { name: "Someone", role: "primary" },
      { name: "B", role: "primary" },
    ])
    expect(entry.gameId).toBe("")
    expect(entry.sources).toEqual([])
    expect(entry.verified).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildTimeline

describe("buildTimeline", () => {
  it("turns the catalog alone into one entry per song, sorted by date then title", () => {
    const { data, report } = buildTimeline(inputs())
    expect(data.entries).toHaveLength(catalog.songs.length)
    expect(data.entries.every((e) => e.inArchive)).toBe(true)
    // By date, then title ("All-Star Paris 2014" and "Jett Theme" share 2020-01-01).
    expect(data.entries.map((e) => e.id)).toEqual([
      "2014-world-championship-theme",
      "warriors",
      "pop-stars",
      "tagged-song",
      "all-star-paris-2014",
      "jett-theme",
      "27",
      "aurora-the-witch-between-worlds",
    ])
    expect(data.generatedAt).toBe("2026-10-14T00:00:00.000Z")
    expect(report.totals.entries).toBe(catalog.songs.length)
    expect(report.byDateSource).toEqual({ "release-date": 4, year: 4 })
    const theme = byId(data.entries, "2014-world-championship-theme")
    expect(theme).toMatchObject({ date: "2014-01-01", datePrecision: "year", year: 2014, month: 1 })
    expect(theme.tags).toContain("worlds-theme")
    expect(theme.tags).not.toContain("worlds")
    expect(theme.categoryIds).toEqual(["soundtrack", "worlds-theme"])
    expect(theme.primaryCategoryId).toBe("soundtrack")
    const pop = byId(data.entries, "pop-stars")
    expect(pop.background).toBe("K/DA take the stage with their debut single. Watch it live at 8:00 a.m. PT on.")
    expect(pop.usedFor).toBe("K/DA song")
    expect(byId(data.entries, "jett-theme").usedFor).toBe("Agent theme")
    expect(byId(data.entries, "all-star-paris-2014").tags).toContain("all-stars")
    expect(byId(data.entries, "aurora-the-witch-between-worlds").tags).toEqual(["champion-theme"])
  })

  it("applies research: date precision, usedFor, background, cover and sources", () => {
    const { data, report } = full()
    const pop = byId(data.entries, "pop-stars")
    expect(pop.usedFor).toBe("K/DA debut single")
    expect(pop.background).toBe("Written in our own words.")
    expect(pop.sources).toEqual([{ title: "Riot", url: "https://example.com/riot" }])
    // Official song artwork beats the research cover.
    expect(pop.coverUrl).toBe("/media/covers/song-pop-stars.jpg")
    expect(pop.palette).toEqual(["#ff00aa", "#000000"])

    const s27 = byId(data.entries, "27")
    expect(s27).toMatchObject({ date: "2021-12-01", datePrecision: "month", year: 2021, month: 12 })
    expect(s27.coverUrl).toBe("https://example.com/27.jpg")
    expect(s27.palette).toEqual(["#272727"])
    expect(s27.tags).toContain("sessions")
    expect(s27.usedFor).toBe("Track from Sessions: Diana")

    const warriors = byId(data.entries, "warriors")
    expect(warriors.date).toBe("2014-09-22")
    expect(report.invalidDates).toContainEqual({ songId: "warriors", source: "research", value: "2014-02-30" })
    expect(report.unknownIds).toContainEqual({ kind: "research", file: "research/a.json", songId: "no-such-song" })
    expect(report.conflicts).toContainEqual({
      kind: "research",
      id: "27",
      kept: "research/a.json",
      ignored: "research/b.json",
      identical: false,
    })
  })

  it("resolves local media, the listen link and the other videos", () => {
    const { data } = full()
    const pop = byId(data.entries, "pop-stars")
    expect(pop.audioUrl).toBe("/media/audio/AUDIOpopst1.m4a")
    expect(pop.listenUrl).toBeNull()
    expect(pop.duration).toBe(202.943)
    expect(pop.uploadDate).toBe("2018-11-03")
    expect(pop.hasVideo).toBe(true)
    expect(pop.musicVideo).toEqual({
      youtubeId: "MVpopstars1",
      title: "POP/STARS MV",
      kind: "music_video",
      videoUrl: "/media/video/MVpopstars1.mp4",
      youtubeUrl: "https://www.youtube.com/watch?v=MVpopstars1",
      thumbnailUrl: "/media/thumbs/MVpopstars1.jpg",
    })
    expect(pop.videos.map((v) => v.youtubeId)).toEqual(["LIVEpopsta1"])
    expect(pop.videos[0]!.thumbnailUrl).toBe("https://i.ytimg.com/vi/LIVEpopsta1/hqdefault.jpg")
    expect(pop.artists).toEqual([
      { name: "K/DA", role: "primary", id: "k-da" },
      { name: "Madison Beer", role: "featured", id: "madison-beer" },
    ])
    expect(pop.isImpact).toBe(true)
    expect(pop.viewCount).toBe(500)
  })

  it("applies associations: game, replacing tags, music video and audio overrides", () => {
    const { data, report } = full()
    const tagged = byId(data.entries, "tagged-song")
    expect(tagged.gameId).toBe("valorant")
    expect(tagged.tags).toEqual(["k-da", "soundtrack"])
    expect(tagged.categoryIds).toEqual(["soundtrack"])
    expect(tagged.primaryCategoryId).toBe("soundtrack")
    expect(tagged.hasVideo).toBe(false)
    expect(tagged.musicVideo).toBeNull()
    expect(tagged.audioUrl).toBe("/media/audio/NEWAUDIO123.m4a")
    expect(report.unknownTags).toContainEqual({
      file: "associations/a.json",
      songId: "tagged-song",
      tag: "no-such-tag",
    })
    expect(report.conflicts).toContainEqual({
      kind: "association",
      id: "tagged-song",
      kept: "associations/a.json",
      ignored: "associations/b.json",
      identical: false,
    })

    const jett = byId(data.entries, "jett-theme")
    expect(jett.gameId).toBe("valorant")
    expect(report.unknownGames).toContainEqual({
      file: "associations/a.json",
      songId: "jett-theme",
      gameId: "fortnite",
    })
    expect(jett.categoryIds).toEqual(["champion-theme", "cinematic"])
    expect(jett.primaryCategoryId).toBe("champion-theme")
    expect(jett.musicVideo).toMatchObject({
      youtubeId: "CLASSVID001",
      title: "Jett Theme | VALORANT",
      kind: "champion_theme",
      videoUrl: null,
    })
    expect(jett.listenUrl).toBe("https://www.youtube.com/watch?v=CLASSVID001")

    // A video that video-classes skips is never used, even when an association names it.
    const aurora = byId(data.entries, "aurora-the-witch-between-worlds")
    expect(aurora.hasVideo).toBe(false)
    expect(aurora.tags).toEqual(["champion-theme"])
    expect(report.excludedVideos).toContainEqual(
      expect.objectContaining({
        songId: "aurora-the-witch-between-worlds",
        youtubeId: "SKIPPEDVID1",
        field: "musicVideo",
      }),
    )
  })

  it("adds verified extras and drops unverified, invalid, duplicate and removed ones", () => {
    const { data, report } = full()
    expect(data.entries).toHaveLength(catalog.songs.length + 2)
    const lor = byId(data.entries, "x-lor-theme")
    expect(lor).toMatchObject({
      inArchive: false,
      gameId: "legends-of-runeterra",
      displayArtist: "Madison Beer ft. Someone New",
      date: "2020-04-29",
      background: "Research on an extra.",
      audioUrl: null,
      listenUrl: "https://www.youtube.com/watch?v=XTRAAUDIO01",
      coverUrl: "https://i.ytimg.com/vi/XTRAAUDIO01/hqdefault.jpg",
      uploadDate: "2020-06-02",
      duration: null,
      viewCount: null,
      isImpact: false,
    })
    expect(lor.artists).toEqual([
      { name: "Madison Beer", role: "primary", id: "madison-beer" },
      { name: "Someone New", role: "featured", id: null },
    ])
    expect(lor.tags).toEqual(["k-da", "soundtrack"])
    expect(lor.musicVideo).toMatchObject({ youtubeId: "XTRAMV00001", title: "Extra MV from meta", kind: "music_video" })

    const spotify = byId(data.entries, "x-spotify-only")
    expect(spotify).toMatchObject({
      datePrecision: "year",
      listenUrl: "https://open.spotify.com/track/abc",
      coverUrl: "https://example.com/cover.jpg",
      hasVideo: false,
      usedFor: "League of Legends soundtrack",
    })

    expect(report.droppedExtras.map((d) => [d.id, d.reason])).toEqual([
      ["x-unverified", "verified: false"],
      ["bad-id", 'id must be "x-" + a kebab-case slug'],
      ["x-fortnite", 'unknown game "fortnite"'],
      ["x-you-are-my-legend", "removed from the archive on purpose"],
    ])
    expect(report.duplicates).toEqual([
      {
        file: "extras/a.json",
        id: "x-pop-stars",
        title: "POP/STARS (feat. Madison Beer)",
        gameId: "league-of-legends",
        duplicateOf: "pop-stars",
        dropped: true,
      },
    ])
    expect(report.conflicts).toContainEqual({
      kind: "extra",
      id: "x-lor-theme",
      kept: "extras/a.json",
      ignored: "extras/b.json",
      identical: false,
    })
    expect(data.entries.some((e) => e.title === "You Are My Legend")).toBe(false)
  })

  it("computes discs (keeping empty ones) and reports taxonomy gaps", () => {
    const { data, report } = full()
    const disc = (id: string) => data.discs.find((d) => d.id === id)!
    expect(disc("all").entryCount).toBe(data.entries.length)
    expect(disc("all")).toMatchObject({ firstYear: 2014, lastYear: 2024 })
    expect(disc("lor")).toMatchObject({ entryCount: 1, firstYear: 2020, lastYear: 2020 })
    expect(disc("val").entryCount).toBe(2)
    expect(disc("empty")).toMatchObject({ entryCount: 0, firstYear: null, lastYear: null })
    expect(disc("worlds").entryCount).toBe(2)
    expect(disc("kda").entryCount).toBe(3)
    expect(report.byDisc).toMatchObject({ all: data.entries.length, empty: 0 })
    expect(report.taxonomy.categoriesWithoutTag).toEqual(["arcane"])
    expect(report.taxonomy.unknownDiscReferences).toEqual([{ disc: "kda", kind: "tag", id: "no-such-tag" }])
    expect(data.tags.map((t) => t.id)).toContain("k-da")
    // Every entry's categories are a subset of its tags.
    for (const entry of data.entries) for (const c of entry.categoryIds) expect(entry.tags).toContain(c)
  })

  it("slims entries for the client payload", () => {
    const { data } = full()
    const slim = toTimelineEntry(byId(data.entries, "pop-stars"))
    expect(Object.keys(slim)).not.toContain("background")
    expect(Object.keys(slim)).not.toContain("musicVideo")
    expect(slim).toMatchObject({ id: "pop-stars", hasVideo: true, audioUrl: "/media/audio/AUDIOpopst1.m4a" })
  })

  it("works without a timeline taxonomy", () => {
    const { data, report } = buildTimeline(inputs({ timelineTaxonomy: null }))
    expect(data.discs.map((d) => d.id)).toEqual(["all"])
    expect(data.discs[0]!.entryCount).toBe(catalog.songs.length)
    expect(data.tags.map((t) => t.id)).toEqual(taxonomy.categories.map((c) => c.id))
    expect(report.taxonomy.categoriesWithoutTag).toEqual([])
  })
})
