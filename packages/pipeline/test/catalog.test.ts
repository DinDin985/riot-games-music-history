import { describe, expect, it } from "@effect/vitest"
import { buildCatalog, isRemixAlbum, topicCredits } from "../src/catalog/build.ts"
import { idLockReport, lockSongIds } from "../src/catalog/id-lock.ts"
import type { CatalogInputs, InfoMeta, TopicTrackInput, VideoClassInput } from "../src/catalog/inputs.ts"
import { remixGroups } from "../src/catalog/normalize.ts"
import { gameFromText, heuristicCategories, isWorldsTheme, splitWorlds } from "../src/catalog/rules.ts"
import type { Catalog, CatalogSong } from "../src/catalog/types.ts"
import { sources } from "../src/sources.ts"

// ---------------------------------------------------------------------------
// Fixtures

const taxonomy: CatalogInputs["taxonomy"] = {
  games: ["league-of-legends", "valorant", "arcane", "teamfight-tactics", "riot-games"].map((id) => ({
    id,
    name: id,
    short: id,
    color: "#888888",
  })),
  categories: ["worlds", "champion-theme", "cinematic", "arcane", "virtual-group", "skin-line", "soundtrack", "esports", "remix"].map(
    (id) => ({ id, name: id, description: "" }),
  ),
}

const topic = (
  id: string,
  source: string,
  title: string,
  meta: Partial<InfoMeta> & { readonly duration: number },
): TopicTrackInput => ({
  id,
  source,
  tsvTitle: title,
  tsvDuration: meta.duration,
  meta: { title, track: title, ...meta },
  audioExists: true,
})

const video = (v: Partial<VideoClassInput> & Pick<VideoClassInput, "id" | "source" | "kind" | "role">): VideoClassInput => ({
  title: v.song ?? v.id,
  durationSeconds: 180,
  song: null,
  artists: [],
  game: null,
  categories: [],
  year: null,
  topicTrackId: null,
  mvRank: null,
  ...v,
})

const inputs = (topicTracks: ReadonlyArray<TopicTrackInput>, videoClasses: ReadonlyArray<VideoClassInput> = []): CatalogInputs => ({
  taxonomy,
  topicTracks,
  videoClasses,
  videoMeta: new Map(),
  wikiSongs: [],
  wikiAlbums: [],
  spotifyTracks: [],
  impact: [],
})

const build = (i: CatalogInputs, previous?: Catalog | null) => buildCatalog(i, { now: "2026-01-01T00:00:00.000Z", previous })
const byTitle = (catalog: Catalog, title: string): CatalogSong => {
  const song = catalog.songs.find((s) => s.title === title)
  if (!song) throw new Error(`no song titled ${title}: ${catalog.songs.map((s) => s.title).join(", ")}`)
  return song
}
const artistName = (catalog: Catalog, id: string) => catalog.artists.find((a) => a.id === id)?.name

// ---------------------------------------------------------------------------
// Id lock

describe("song id lock", () => {
  const lobby = topic("T_LOBBY_1", "topic_lol", "Lobby", { artists: ["League of Legends"], duration: 120, release_date: "20190101" })
  const lobbyMv = video({
    id: "V_LOBBY_MV",
    source: "tft",
    kind: "music_video",
    role: "primary_mv",
    song: "Lobby",
    artists: [{ name: "Some Band", role: "primary" }],
    durationSeconds: 200,
  })

  it("keeps an existing id when a more important namesake appears", () => {
    const first = build(inputs([lobby])).catalog
    expect(first.songs.map((s) => s.id)).toEqual(["lobby"])

    // A second, unrelated "Lobby" with a music video ranks first, so a fresh build hands it the bare slug…
    const next = inputs([lobby], [lobbyMv])
    const fresh = build(next).catalog
    expect(fresh.songs.find((s) => s.musicVideo?.youtubeId === "V_LOBBY_MV")?.id).toBe("lobby")

    // …but with the previous catalog the existing song keeps "lobby" and the new one gets another slug.
    const { catalog, stats } = build(next, first)
    expect(catalog.songs.find((s) => s.audio?.youtubeId === "T_LOBBY_1")?.id).toBe("lobby")
    expect(catalog.songs.find((s) => s.musicVideo?.youtubeId === "V_LOBBY_MV")?.id).toBe("lobby-some-band")
    expect(stats.ids).toEqual({ kept: 1, fresh: ["lobby-some-band"], changed: [], dropped: [] })
  })

  it("follows a song whose audio source changed (music video → Topic art track) via its music video", () => {
    const mvOnly = video({
      id: "V_ANTHEM",
      source: "tft",
      kind: "music_video",
      role: "primary_mv",
      song: "Anthem",
      artists: [{ name: "Singer", role: "primary" }],
    })
    const first = build(inputs([], [mvOnly])).catalog
    const renamed = { ...first, songs: first.songs.map((s) => ({ ...s, id: "anthem-legacy-id" })) }
    expect(renamed.songs[0]!.audio).toEqual({ youtubeId: "V_ANTHEM", kind: "music_video" })

    const art = topic("T_ANTHEM", "topic_tft", "Anthem", { artists: ["Teamfight Tactics", "Singer"], duration: 180 })
    const { catalog, stats } = build(inputs([art], [{ ...mvOnly, topicTrackId: "T_ANTHEM" }]), renamed)
    expect(catalog.songs).toHaveLength(1)
    expect(catalog.songs[0]!.audio).toEqual({ youtubeId: "T_ANTHEM", kind: "topic" })
    expect(catalog.songs[0]!.id).toBe("anthem-legacy-id")
    expect(stats.ids.kept).toBe(1)
  })

  it("never reuses the id of a previous song for a different new song", () => {
    const gone = build(inputs([topic("T_OLD", "topic_lol", "Echo", { duration: 100 })])).catalog
    expect(gone.songs[0]!.id).toBe("echo")
    const { catalog, stats } = build(inputs([topic("T_NEW", "topic_lol", "Echo", { duration: 300 })]), gone)
    expect(catalog.songs[0]!.id).not.toBe("echo")
    expect(stats.ids.dropped).toEqual(["echo"])
    expect(stats.ids.fresh).toEqual([catalog.songs[0]!.id])
  })

  it("prefers the audio match over a music-video match and hands each previous id out once", () => {
    const song = (id: string, audio: string, mv: string | null): CatalogSong => ({
      id,
      title: id,
      displayArtist: "",
      artists: [],
      gameId: "riot-games",
      primaryCategoryId: "soundtrack",
      categoryIds: ["soundtrack"],
      album: null,
      year: null,
      releaseDate: null,
      audio: { youtubeId: audio, kind: "topic" },
      musicVideo: mv ? { youtubeId: mv, kind: "music_video" } : null,
      videos: [],
      coverYoutubeId: null,
      viewCount: null,
      isImpact: false,
      impactSlug: null,
      description: null,
    })
    const previous: Catalog = { generatedAt: "", artists: [], songs: [song("a", "A1", "MV"), song("b", "B1", null)] }
    const candidates = [
      { key: 1, audioId: "B1", topicIds: [], musicVideoId: "MV" },
      { key: 2, audioId: "A1", topicIds: [], musicVideoId: null },
      { key: 3, audioId: "Z9", topicIds: [], musicVideoId: "MV" },
    ]
    const lock = lockSongIds(previous, candidates)
    expect([...lock.locked.entries()].sort()).toEqual([
      [1, "b"],
      [2, "a"],
    ])
    expect([...lock.reserved].sort()).toEqual(["a", "b"])
    const report = idLockReport(previous, candidates, lock, new Map([[1, "b"], [2, "a"], [3, "c"]]))
    expect(report).toEqual({ kept: 2, fresh: ["c"], changed: [], dropped: [] })
  })
})

// ---------------------------------------------------------------------------
// Teamfight Tactics

describe("Worlds anthems vs orchestral themes", () => {
  it("recognises the yearly orchestral theme titles", () => {
    for (const title of ["2019 World Championship Theme", "Season 3 World Championship", "Season 3 Finals", "Worlds 2016 Finals"])
      expect(isWorldsTheme(title)).toBe(true)
    for (const title of ["Legends Never Die", "Worlds Collide", "Hero (Worlds Remix)", "RISE (REDUX)"]) expect(isWorldsTheme(title)).toBe(false)
  })

  it("files a theme under worlds-theme only, and an anthem under worlds only", () => {
    const theme = new Set(["worlds", "login-screen"])
    splitWorlds(theme, "2017 World Championship Theme")
    expect([...theme].sort()).toEqual(["login-screen", "worlds-theme"])
    const anthem = new Set(["worlds", "worlds-theme"])
    splitWorlds(anthem, "Phoenix")
    expect([...anthem]).toEqual(["worlds"])
  })
})

describe("Teamfight Tactics", () => {
  it("has its YouTube sources configured", () => {
    const tft = sources.filter((s) => s.game === "teamfight-tactics")
    expect(tft.map((s) => `${s.key}:${s.kind}`).sort()).toEqual(["tft:channel", "topic_tft2:topic", "topic_tft:topic"])
    expect(sources.find((s) => s.key === "tft")?.url).toContain("@playtft")
  })

  it("detects TFT albums and titles, not Arcane, for Into the Arcane", () => {
    expect(gameFromText("Into the Arcane (Original Soundtrack from Teamfight Tactics)")).toBe("teamfight-tactics")
    expect(gameFromText("REMIX RUMBLE")).toBe("teamfight-tactics")
    expect(gameFromText("Teamfight Tactics - Lobby (From League of Legends: Season 9)")).toBe("teamfight-tactics")
  })

  it("does not treat the REMIX RUMBLE set name as a remix, but its regional remixes are", () => {
    const ctx = { album: "REMIX RUMBLE", isVirtualGroup: false, hasRemixer: false, gameId: "teamfight-tactics" }
    expect(heuristicCategories({ ...ctx, title: "REMIX RUMBLE" }).has("remix")).toBe(false)
    expect(heuristicCategories({ ...ctx, title: "REMIX RUMBLE (Korea Remix)" }).has("remix")).toBe(true)
    expect(heuristicCategories({ ...ctx, title: "TFT Open 2024 Theme", album: null }).has("esports")).toBe(true)
  })

  it("parses remixers inside nested brackets", () => {
    expect(remixGroups("REMIX RUMBLE (Karol Suchecki (Poland) Remix)")).toEqual(["Karol Suchecki (Poland) Remix"])
    expect(remixGroups("REMIX RUMBLE (LATAM Remix (Instrumental))")).toEqual(["LATAM Remix (Instrumental)"])
    expect(remixGroups("Phoenix (Blanke Remix)")).toEqual(["Blanke Remix"])
  })

  const tftInputs = inputs(
    [
      topic("T_WILDS", "topic_tft", "Enter the Wilds", {
        artists: ["Teamfight Tactics"],
        album: "Enchanted Wilds (Original Soundtrack from Teamfight Tactics)",
        duration: 125,
        release_date: "20260827",
      }),
      topic("T_GODS", "topic_tft", "(space) GODS", { artists: ["Teamfight Tactics"], album: "Space Gods", duration: 189 }),
      // Shapes of the real art tracks: the remixer is often only named in the description.
      topic("T_KOREA", "topic_tft", "REMIX RUMBLE (Korea Remix)", {
        artists: ["Teamfight Tactics", "Ava Grace"],
        album: "Teamfight Tactics REMIX RUMBLE",
        duration: 260,
        description: "Mastering Engineer, Remixer, Producer: GroovyPark\nLyricist: Ava Grace\nComposer: Steve Aoki",
      }),
      topic("T_POLAND", "topic_tft", "REMIX RUMBLE (Karol Suchecki (Poland) Remix)", {
        artists: ["Teamfight Tactics"],
        album: "Teamfight Tactics REMIX RUMBLE",
        duration: 207,
        description: "Remixer: Karol Suchecki\nComposer: Michał Kural",
      }),
      topic("T_RUMBLE", "topic_tft", "REMIX RUMBLE", {
        artists: ["Teamfight Tactics"],
        album: "REMIX RUMBLE",
        duration: 220,
        description: "Remixer: Steve Aoki\nComposer: Kole Hicks",
      }),
    ],
    [
      video({
        id: "V_DEITY",
        source: "tft",
        kind: "cinematic",
        role: "primary_mv",
        song: "(space) GODS",
        game: "teamfight-tactics",
        categories: ["cinematic"],
        topicTrackId: "T_GODS",
        mvRank: 1,
        durationSeconds: 108,
      }),
      video({
        id: "V_HEIST",
        source: "tft",
        kind: "cinematic",
        role: "primary_mv",
        song: "High Speed Heist",
        categories: ["cinematic"],
        mvRank: 1,
        durationSeconds: 160,
      }),
    ],
  )
  const { catalog } = build(tftInputs)

  it("puts Topic set music under teamfight-tactics as soundtrack", () => {
    const wilds = byTitle(catalog, "Enter the Wilds")
    expect(wilds.gameId).toBe("teamfight-tactics")
    expect(wilds.primaryCategoryId).toBe("soundtrack")
    expect(wilds.displayArtist).toBe("Riot Games Music")
  })

  it("files TFT cinematics under cinematic, linked to their Topic track", () => {
    const gods = byTitle(catalog, "(space) GODS")
    expect(gods.gameId).toBe("teamfight-tactics")
    expect(gods.primaryCategoryId).toBe("cinematic")
    expect(gods.musicVideo).toEqual({ youtubeId: "V_DEITY", kind: "cinematic" })
    expect(gods.audio).toEqual({ youtubeId: "T_GODS", kind: "topic" })
    // A score-only cinematic without a Topic track still lands in TFT through its channel.
    const heist = byTitle(catalog, "High Speed Heist")
    expect(heist.gameId).toBe("teamfight-tactics")
    expect(heist.audio).toEqual({ youtubeId: "V_HEIST", kind: "music_video" })
  })

  it("credits regional REMIX RUMBLE remixers as remixers", () => {
    const poland = byTitle(catalog, "REMIX RUMBLE (Karol Suchecki (Poland) Remix)")
    expect(poland.categoryIds).toContain("remix")
    expect(poland.artists.map((a) => [artistName(catalog, a.id), a.role])).toEqual([
      ["Karol Suchecki", "remixer"],
      ["Michał Kural", "composer"],
    ])
    const korea = byTitle(catalog, "REMIX RUMBLE (Korea Remix)")
    expect(korea.artists.map((a) => [artistName(catalog, a.id), a.role])).toEqual([
      ["Ava Grace", "primary"],
      ["GroovyPark", "remixer"],
      ["Steve Aoki", "composer"],
    ])
    // The set theme itself is not a remix, and its "Remixer:" line is not applied to a non-remix title.
    const theme = byTitle(catalog, "REMIX RUMBLE")
    expect(theme.categoryIds).not.toContain("remix")
    expect(theme.primaryCategoryId).toBe("soundtrack")
  })
})

// ---------------------------------------------------------------------------
// Credits

describe("remix-album credits", () => {
  it("credits Riot Games Music, not the Warsongs remixer, as the primary artist", () => {
    expect(isRemixAlbum("Warsongs")).toBe(true)
    expect(isRemixAlbum("Warsongs: Piercing Light")).toBe(false)
    expect(topicCredits("Silver Scrapes", ["Protoshredanoid"], { album: "Warsongs" }).map((c) => [c.name, c.role])).toEqual([
      ["Riot Games Music", "primary"],
      ["Protoshredanoid", "remixer"],
    ])
    expect(topicCredits("Silver Scrapes", ["Danny McCarthy"], { album: null }).map((c) => [c.name, c.role])).toEqual([
      ["Danny McCarthy", "primary"],
    ])
  })

  it("keeps the Warsongs remix video as the music video without handing it the primary credit", () => {
    const { catalog } = build(
      inputs(
        [
          topic("T_SILVER", "topic_lol", "Silver Scrapes", {
            artists: ["League of Legends", "Protoshredanoid"],
            album: "Warsongs",
            duration: 258,
            description: "Silver Scrapes · League of Legends · Protoshredanoid\n\nWarsongs\n\nComposer: Danny McCarthy",
          }),
        ],
        [
          video({
            id: "V_SILVER",
            source: "lol_videos",
            kind: "remix",
            role: "primary_mv",
            song: "Silver Scrapes",
            artists: [{ name: "ProtoShredanoid", role: "primary" }],
            topicTrackId: "T_SILVER",
            mvRank: 1,
            durationSeconds: 258,
          }),
        ],
      ),
    )
    const song = byTitle(catalog, "Silver Scrapes")
    expect(song.displayArtist).toBe("Riot Games Music")
    expect(song.musicVideo?.youtubeId).toBe("V_SILVER")
    expect(song.artists.map((a) => [artistName(catalog, a.id), a.role])).toEqual([
      ["Riot Games Music", "primary"],
      ["ProtoShredanoid", "remixer"],
      ["Danny McCarthy", "composer"],
    ])
  })
})
