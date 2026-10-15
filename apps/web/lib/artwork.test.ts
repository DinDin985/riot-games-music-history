import { describe, expect, it } from "vitest"
import type { SongSummary } from "@workspace/db/domain/types"
import { artworkKey, distinctCovers } from "./artwork.ts"

/** A song whose picture is `picture` (same picture ⇒ same palette, as the pipeline derives it). */
const song = (id: string, picture: string | null, palette?: ReadonlyArray<string>): SongSummary => ({
  id,
  title: id,
  displayArtist: "Riot Games Music",
  gameId: "league-of-legends",
  primaryCategoryId: "worlds",
  categoryIds: ["worlds"],
  year: 2020,
  duration: 200,
  viewCount: null,
  isImpact: false,
  hasAudio: true,
  hasVideo: false,
  audioUrl: null,
  // Tracks of one album: one picture, a different file per track.
  coverUrl: picture === null ? null : `/media/covers/${id}.jpg`,
  gifUrl: null,
  palette: palette ?? (picture === null ? [] : [`#${picture}`, "#0c1d2e"]),
})

const ids = (cards: ReadonlyArray<ReadonlyArray<SongSummary>>) => cards.map((c) => c.map((s) => s.id))

describe("artworkKey", () => {
  it("uses the pipeline's coverKey, which also groups re-encoded copies whose palettes differ", () => {
    const upload = { ...song("milio", "51281d"), coverKey: "covers/milio-a.jpg" }
    const reupload = { ...song("milio-champion-theme", "52251b"), coverKey: "covers/milio-a.jpg" }
    expect(artworkKey(upload)).toBe(artworkKey(reupload))
    expect(ids(distinctCovers([[upload, reupload, song("other", "cccccc")]], 2, 0))).toEqual([["milio", "other"]])
    expect(artworkKey({ ...song("x", null), coverKey: "covers/x.jpg" })).toBeNull()
  })

  it("without a coverKey, matches album tracks whose cover files differ but whose palette is the same", () => {
    expect(artworkKey(song("a", "aaaaaa"))).toBe(artworkKey(song("b", "aaaaaa")))
    expect(artworkKey(song("a", "aaaaaa"))).not.toBe(artworkKey(song("c", "cccccc")))
  })

  it("falls back to the file without a palette, and is null without a cover", () => {
    expect(artworkKey(song("a", "aaaaaa", []))).toBe("/media/covers/a.jpg")
    expect(artworkKey(song("a", "aaaaaa", []))).not.toBe(artworkKey(song("b", "aaaaaa", [])))
    expect(artworkKey(song("x", null))).toBeNull()
  })
})

describe("distinctCovers", () => {
  it("never repeats a picture inside one card", () => {
    const album = [song("t1", "aaaaaa"), song("t2", "aaaaaa"), song("t3", "bbbbbb"), song("t4", "aaaaaa")]
    expect(ids(distinctCovers([album], 3, 0))).toEqual([["t1", "t3"]])
  })

  it("gives a shared song to the first card and the next pictures to the later ones", () => {
    // POP/STARS is the top song of Virtual Groups, Login Screens and Skin Lines.
    const popstars = song("pop-stars", "aaaaaa")
    const cards = distinctCovers(
      [
        [popstars, song("giants", "bbbbbb"), song("more", "cccccc")],
        [popstars, song("login-1", "dddddd"), song("login-2", "eeeeee")],
        [popstars, song("giants", "bbbbbb"), song("skin-1", "ffffff"), song("skin-2", "999999")],
      ],
      2,
      3,
    )
    expect(ids(cards)).toEqual([
      ["pop-stars", "giants"],
      ["login-1", "login-2"],
      ["skin-1", "skin-2"],
    ])
  })

  it("reuses a picture only from a card more than `columns + 1` places away", () => {
    const shared = song("shared", "aaaaaa")
    const filler = (i: number) => [song(`f${i}`, `f0000${i}`)]
    // Card 0 and card 5 both only have `shared`; cards 1–4 sit in between.
    const cards = distinctCovers([[shared], filler(1), filler(2), filler(3), filler(4), [shared]], 1, 3)
    expect(ids(cards)[5]).toEqual(["shared"])
    // …but 4 places away is a neighbour (side, above/below or diagonal) in a 3-column grid.
    const near = distinctCovers([[shared], filler(1), filler(2), filler(3), [shared]], 1, 3)
    expect(ids(near)[4]).toEqual([])
  })

  it("tops up a short card with songs that have no cover", () => {
    const cards = distinctCovers([[song("a", "aaaaaa")], [song("b", "aaaaaa"), song("x", null)]], 2, 3)
    expect(ids(cards)).toEqual([["a"], ["x"]])
  })

  it("keeps every picture unique across the page whenever the cards have enough", () => {
    const pool = Array.from({ length: 12 }, (_, i) => song(`s${i}`, `${i}`.padStart(6, "0")))
    // Every card can choose from the same 12 songs, most popular first.
    const cards = distinctCovers(Array.from({ length: 4 }, () => pool), 3, 3)
    const keys = cards.flat().map(artworkKey)
    expect(keys).toHaveLength(12)
    expect(new Set(keys).size).toBe(12)
  })
})
