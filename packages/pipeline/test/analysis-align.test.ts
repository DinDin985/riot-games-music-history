import { describe, expect, it } from "@effect/vitest"
import { songToVideo, videoToSong } from "@workspace/db/domain/alignment"
import { align } from "../src/analysis/align.ts"
import type { AlignmentFeatures } from "../src/analysis/features.ts"
import { toAlignmentFile } from "../src/stages/align.ts"

/**
 * The aligner on synthetic features: a "music video" that opens with 11 s of
 * video-only material, plays the first half of the song, cuts to an 8 s skit,
 * then plays the rest of the song and a short outro. Every stream (chroma,
 * onset envelope, decimated waveform) is spliced identically, as it would be
 * for an MV that reuses the released master.
 */

const SR = 22050
const HOP = 2048 / SR
const ONSET_PER_FRAME = 2048 / 256
const DECIMATED_PER_FRAME = 2048 / 4

const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

interface Streams {
  chroma: Float32Array[]
  onset: Float32Array
  decimated: Float32Array
}

/** Random material of `frames` chroma frames (chroma changes every 4 frames, like real harmony). */
const material = (frames: number, random: () => number): Streams => {
  const chroma: Float32Array[] = []
  let current = new Float32Array(12)
  for (let f = 0; f < frames; f++) {
    if (f % 4 === 0) {
      current = Float32Array.from({ length: 12 }, () => random() - 0.5)
      const norm = Math.hypot(...current)
      current = current.map((v) => v / norm)
    }
    chroma.push(current)
  }
  return {
    chroma,
    onset: Float32Array.from({ length: frames * ONSET_PER_FRAME }, () => random() * 2 - 1),
    decimated: Float32Array.from({ length: frames * DECIMATED_PER_FRAME }, () => random() * 2 - 1),
  }
}

const slice = (s: Streams, from: number, to: number): Streams => ({
  chroma: s.chroma.slice(from, to),
  onset: s.onset.slice(from * ONSET_PER_FRAME, to * ONSET_PER_FRAME),
  decimated: s.decimated.slice(from * DECIMATED_PER_FRAME, to * DECIMATED_PER_FRAME),
})

const concat = (...parts: Streams[]): Streams => {
  const join = (arrays: Float32Array[]) => {
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0))
    let at = 0
    for (const a of arrays) {
      out.set(a, at)
      at += a.length
    }
    return out
  }
  return {
    chroma: parts.flatMap((p) => p.chroma),
    onset: join(parts.map((p) => p.onset)),
    decimated: join(parts.map((p) => p.decimated)),
  }
}

const features = (s: Streams): AlignmentFeatures => {
  const chroma = new Float32Array(s.chroma.length * 12)
  s.chroma.forEach((frame, i) => chroma.set(frame, i * 12))
  return {
    sampleRate: SR,
    hopSeconds: HOP,
    frames: s.chroma.length,
    chroma,
    onsetHopSeconds: 256 / SR,
    onset: s.onset,
    durationSeconds: s.chroma.length * HOP,
    decimated: s.decimated,
    decimatedRate: SR / 4,
  }
}

describe("song ↔ music video alignment (synthetic)", () => {
  const random = rng(42)
  const songStreams = material(1300, random) // ≈ 121 s
  const intro = material(120, random) // ≈ 11.1 s
  const skit = material(90, random) // ≈ 8.4 s
  const outro = material(60, random)
  const videoStreams = concat(intro, slice(songStreams, 0, 650), skit, slice(songStreams, 650, 1300), outro)
  const song = features(songStreams)
  const video = features(videoStreams)
  const result = align(song, video)

  const firstOffset = 120 * HOP
  const secondOffset = (120 + 90) * HOP

  it("finds the two matched spans with exact offsets", () => {
    expect(result.segments.length).toBe(2)
    expect(result.segments[0]!.offset).toBeCloseTo(firstOffset, 2)
    expect(result.segments[1]!.offset).toBeCloseTo(secondOffset, 2)
    expect(result.refinement.every((m) => m === "waveform")).toBe(true)
    expect(result.coverage).toBeGreaterThan(0.9)
  })

  it("places the cut where the skit starts", () => {
    expect(result.segments[0]!.songEnd).toBeCloseTo(650 * HOP, 0)
    expect(result.segments[1]!.songStart).toBeCloseTo(650 * HOP, 0)
  })

  it("maps song time to video time across the cut", () => {
    const early = songToVideo(result, 20)
    expect(early.kind).toBe("exact")
    expect(early.videoTime).toBeCloseTo(20 + firstOffset, 2)
    const late = songToVideo(result, 100)
    expect(late.kind).toBe("exact")
    expect(late.videoTime).toBeCloseTo(100 + secondOffset, 2)
  })

  it("reports video-only material during the skit", () => {
    const duringSkit = videoToSong(
      { segments: result.segments, songDuration: song.durationSeconds, videoDuration: video.durationSeconds },
      (120 + 650 + 45) * HOP,
    )
    expect(duringSkit.kind).toBe("video-only")
  })

  it("shifts offsets into video presentation time when the audio stream starts late", () => {
    const file = toAlignmentFile(
      { songId: "song", videoId: "video" },
      { ...result, songDuration: song.durationSeconds, videoDuration: video.durationSeconds },
      0.25,
      null,
    )
    expect(file.segments[0]!.offset).toBeCloseTo(firstOffset + 0.25, 3)
    expect(file.segments[1]!.videoStart).toBeCloseTo(result.segments[1]!.videoStart + 0.25, 3)
    expect(file.method).toBe("audio:waveform")
    expect(songToVideo(file, 20).videoTime).toBeCloseTo(20 + firstOffset + 0.25, 2)
  })
})
