import { describe, expect, it } from "vitest"
import {
  type ArtworkCandidate,
  artistKeys,
  baseKey,
  indexCandidates,
  matchSong,
  type SongForArtwork,
  versionKey,
} from "../src/artwork/match.ts"

const sc = (id: string, title: string, duration: number, artist = "League of Legends", extra: Partial<ArtworkCandidate> = {}): ArtworkCandidate => ({
  source: "soundcloud",
  id,
  title,
  artists: [artist],
  duration,
  artworkUrl: `https://i1.sndcdn.com/artworks-${id}-original.jpg`,
  pageUrl: `https://soundcloud.com/leagueoflegends/${id}`,
  album: null,
  releaseDate: "2017-09-22",
  ...extra,
})

const song = (title: string, duration: number | null, artistNames: ReadonlyArray<string> = [], extra: Partial<SongForArtwork> = {}): SongForArtwork => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  title,
  artistNames,
  duration,
  durationFromVideo: false,
  album: null,
  ...extra,
})

describe("title keys", () => {
  it("separates base title from version", () => {
    expect(baseKey("Legends Never Die (Alan Walker Remix)")).toBe("legends never die")
    expect(versionKey("Legends Never Die (Alan Walker Remix)")).toBe("alan walker remix")
    expect(versionKey("Legends Never Die (ft. Against The Current)")).toBe("")
    expect(baseKey("Enemy (with JID) - from the series Arcane League of Legends")).toBe("enemy")
    expect(versionKey("Know My Name (Instrumental)")).toBe("instrumental")
    expect(versionKey("Phoenix - Blanke Remix")).toBe("blanke remix")
  })

  it("drops label pseudo-artists and splits credit strings", () => {
    expect([...artistKeys(["League of Legends， Pentakill"])]).toEqual(["pentakill"])
    expect([...artistKeys(["Against The Current", "Mako"])].sort()).toEqual(["againstthecurrent", "mako"])
  })
})

describe("matchSong", () => {
  it("auto-matches the same song and duration, ignoring other versions", () => {
    const index = indexCandidates([
      sc("lnd", "Legends Never Die (ft. Against The Current)", 234, "League of Legends, Against The Current"),
      sc("lnd-remix", "Legends Never Die (Alan Walker Remix)", 167),
      sc("lnd-inst", "Legends Never Die (Instrumental)", 234),
    ])
    const match = matchSong(song("Legends Never Die", 235.1, ["Against The Current"]), index)
    expect(match.status).toBe("auto")
    expect(match.chosen?.id).toBe("lnd")
    expect(match.candidates.map((c) => c.candidate.id)).toEqual(["lnd"])
  })

  it("never pairs a remix with the original's cover", () => {
    const index = indexCandidates([sc("phoenix", "Phoenix", 208)])
    expect(matchSong(song("Phoenix (Blanke Remix)", 209), index).status).toBe("none")
  })

  it("asks for review when two different covers fit equally well", () => {
    const index = indexCandidates([sc("a", "Awaken", 199), sc("b", "Awaken", 199)])
    const match = matchSong(song("Awaken", 199), index)
    expect(match.status).toBe("review")
    expect(match.candidates).toHaveLength(2)
  })

  it("prefers the candidate whose duration fits", () => {
    const index = indexCandidates([sc("short", "Warriors", 120), sc("full", "Warriors", 171)])
    const match = matchSong(song("Warriors", 170.5), index)
    expect(match.chosen?.id).toBe("full")
  })
})

describe("Apple release preference", () => {
  const apple = (id: string, title: string, duration: number, album: string, kind: "single" | "ep" | "album"): ArtworkCandidate => ({
    source: "apple",
    id,
    title,
    artists: ["League of Legends", "Against The Current"],
    duration,
    artworkUrl: `https://is1-ssl.mzstatic.com/image/thumb/${id}/3000x3000bb.jpg`,
    pageUrl: `https://music.apple.com/us/album/${id}`,
    album,
    releaseDate: "2017-09-15",
    collectionKind: kind,
  })

  it("uses the song's own single cover over the compilation album, without asking for review", () => {
    const index = indexCandidates([
      apple("worlds-2017-album", "Legends Never Die", 234.6, "The Music of League of Legends: Season 7", "album"),
      apple("lnd-single", "Legends Never Die", 234.6, "Legends Never Die - Single", "single"),
    ])
    const match = matchSong(song("Legends Never Die", 235.1, ["Against The Current"]), index)
    expect(match.status).toBe("auto")
    expect(match.chosen?.id).toBe("lnd-single")
  })

  it("falls back to the album cover when the song has no single", () => {
    const index = indexCandidates([apple("s7", "Piercing Light", 198, "The Music of League of Legends: Season 7", "album")])
    const match = matchSong(song("Piercing Light", 197.4), index)
    expect(match.status).toBe("auto")
    expect(match.chosen?.id).toBe("s7")
  })
})
