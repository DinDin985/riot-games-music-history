import { describe, expect, it } from "@effect/vitest"
import { decodePeaks } from "@workspace/db/domain/media"
import { findChorus } from "../src/analysis/chorus.ts"
import { coverBox, detectBars, extractPalette, rgbToLab, type RawImage } from "../src/analysis/palette.ts"
import { encodePeaks, loudnessEnvelope, PEAKS_RATE } from "../src/analysis/peaks.ts"
import { decimate2 } from "../src/analysis/signal.ts"
import { frameVisibility, letterboxCrop, loudestWindow, MEASURED_CLIPS, pickLiveliest } from "../src/stages/gifs.ts"

/** Deterministic PRNG (mulberry32) so the synthetic fixtures never flake. */
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe("peaks", () => {
  const sr = 44100
  const tone = (seconds: number, amplitude: number) =>
    Float32Array.from({ length: seconds * sr }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / sr))
  const signal = new Float32Array(3 * sr)
  signal.set(tone(1, 0.1), sr)
  signal.set(tone(1, 0.5), 2 * sr)
  const peaks = loudnessEnvelope(signal, sr)

  it("samples at 50 Hz", () => {
    expect(PEAKS_RATE).toBe(50)
    expect(peaks.length).toBe(150)
  })

  it("is silent on silence and normalised to 255 at the loud part", () => {
    expect(Math.max(...peaks.slice(0, 45))).toBe(0)
    expect(Math.min(...peaks.slice(105, 150))).toBe(255)
  })

  it("scales perceptually (amplitude^0.6), not linearly", () => {
    // 0.1 vs 0.5 amplitude: linear would give 51, Stevens' 0.6 power gives ≈ 97
    const quiet = peaks[75]!
    expect(quiet).toBeGreaterThan(90)
    expect(quiet).toBeLessThan(105)
  })

  it("round-trips through base64 with the DB decoder", () => {
    expect(Array.from(decodePeaks(encodePeaks(peaks)))).toEqual(Array.from(peaks))
  })
})

describe("decimate2", () => {
  it("keeps a low tone and removes one above the new Nyquist", () => {
    const sr = 44100
    const low = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / sr))
    const high = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 18000 * i) / sr))
    const rms = (x: Float32Array) => Math.sqrt(x.slice(100, -100).reduce((a, v) => a + v * v, 0) / (x.length - 200))
    expect(rms(decimate2(low))).toBeGreaterThan(0.69)
    expect(rms(decimate2(high))).toBeLessThan(0.02)
  })
})

describe("chorus finder", () => {
  const hop = 2048 / 22050
  /** Chord = pitch-class set; frames get the chord plus a little noise. */
  const chordFrame = (pcs: ReadonlyArray<number>, random: () => number) => {
    const frame = new Float32Array(12)
    for (let c = 0; c < 12; c++) frame[c] = 0.05 * random()
    for (const pc of pcs) frame[pc % 12] = 0.8 + 0.2 * random()
    return frame
  }
  const C = [0, 4, 7]
  const F = [5, 9, 0]
  const G = [7, 11, 2]
  const Am = [9, 0, 4]
  const Dm = [2, 5, 9]
  const Em = [4, 7, 11]
  const Bb = [10, 2, 5]
  const Eb = [3, 7, 10]

  /** Build a song from sections of chord progressions (4 s per chord) at a loudness (power). */
  const song = (sections: ReadonlyArray<{ chords: ReadonlyArray<ReadonlyArray<number>>; power: number }>, seed = 1) => {
    const random = rng(seed)
    const chroma: Float32Array[] = []
    const power: number[] = []
    for (const section of sections) {
      for (const chord of section.chords) {
        const frames = Math.round(4 / hop)
        for (let f = 0; f < frames; f++) {
          chroma.push(chordFrame(chord, random))
          power.push(section.power * (0.8 + 0.4 * random()))
        }
      }
    }
    return { chroma, power: Float32Array.from(power), hopSeconds: hop, duration: chroma.length * hop }
  }

  const intro = { chords: [Am, Am], power: 0.01 }
  const verse = { chords: [Am, F, C, G], power: 0.05 }
  const chorus = { chords: [F, G, Em, Am], power: 0.3 }
  const bridge = { chords: [Dm, Bb, Eb, Dm], power: 0.08 }
  const outro = { chords: [Am, Am], power: 0.02 }

  it("finds the first full chorus of a verse/chorus song", () => {
    // intro 0–8, V 8–24, C 24–40, V 40–56, C 56–72, bridge 72–88, C 88–104, outro 104–112
    const input = song([intro, verse, chorus, verse, chorus, bridge, chorus, outro])
    const found = findChorus(input)
    expect(found).not.toBeNull()
    expect(Math.abs(found!.start - 24)).toBeLessThan(1.5)
    const length = found!.end - found!.start
    expect(length).toBeGreaterThanOrEqual(8)
    expect(length).toBeLessThanOrEqual(16.5)
    expect(found!.confidence).toBeGreaterThan(0.5)
  })

  it("snaps the start to a nearby beat", () => {
    const input = song([intro, verse, chorus, verse, chorus, bridge, chorus, outro])
    const beats = Array.from({ length: 160 }, (_, i) => 0.33 + i * 0.7)
    const found = findChorus({ ...input, beats })!
    expect(beats.some((b) => Math.abs(b - found.start) < 1e-6)).toBe(true)
  })

  it("returns null when nothing repeats", () => {
    const random = rng(7)
    const chords = [C, F, G, Am, Dm, Em, Bb, Eb]
    const sections = Array.from({ length: 24 }, () => ({
      chords: [chords[Math.floor(random() * 8)]!.map((pc) => pc + Math.floor(random() * 12))],
      power: 0.1,
    }))
    expect(findChorus(song(sections, 3))).toBeNull()
  })
})

describe("covers & palette", () => {
  /** 160×90 canvas: 35 px navy bars left/right, 90×90 art of red (60 %), blue (30 %), yellow (10 %). */
  const makeThumb = (): RawImage => {
    const width = 160
    const height = 90
    const data = new Uint8Array(width * height * 3)
    const random = rng(11)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let color = [16, 24, 40]
        if (x >= 35 && x < 125) color = y < 54 ? [208, 32, 32] : y < 81 ? [32, 80, 208] : [240, 208, 32]
        const i = (y * width + x) * 3
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, color[c]! + Math.round((random() - 0.5) * 6)))
      }
    }
    return { data, width, height, channels: 3 }
  }

  it("detects pillarbox bars of any flat colour and crops the square art", () => {
    const thumb = makeThumb()
    const bars = detectBars(thumb)
    expect(bars.left).toBe(35)
    expect(bars.right).toBe(35)
    expect(bars.top).toBe(0)
    expect(coverBox(thumb, bars)).toEqual({ box: { left: 35, top: 0, width: 90, height: 90 }, square: true })
  })

  it("leaves a full-bleed 16:9 frame to the saliency crop", () => {
    const random = rng(5)
    const frame: RawImage = {
      width: 160,
      height: 90,
      channels: 3,
      data: Uint8Array.from({ length: 160 * 90 * 3 }, () => Math.floor(random() * 256)),
    }
    expect(detectBars(frame)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    expect(coverBox(frame).square).toBe(false)
  })

  it("extracts the dominant colours, most common first", () => {
    const thumb = makeThumb()
    // crop the art like the covers stage does
    const art = new Uint8Array(90 * 90 * 3)
    for (let y = 0; y < 90; y++) art.set(thumb.data.subarray((y * 160 + 35) * 3, (y * 160 + 125) * 3), y * 90 * 3)
    const colors = extractPalette({ data: art, width: 90, height: 90, channels: 3 })
    expect(colors.length).toBeGreaterThanOrEqual(3)
    expect(colors.length).toBeLessThanOrEqual(5)
    const lab = (hex: string) =>
      rgbToLab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
    const near = (hex: string, rgb: [number, number, number]) => {
      const a = lab(hex)
      const b = rgbToLab(...rgb)
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 6
    }
    expect(near(colors[0]!, [208, 32, 32])).toBe(true)
    expect(near(colors[1]!, [32, 80, 208])).toBe(true)
    expect(near(colors[2]!, [240, 208, 32])).toBe(true)
  })

  it("prefers real colours over near-black", () => {
    const random = rng(2)
    const data = new Uint8Array(100 * 100 * 3)
    for (let p = 0; p < 100 * 100; p++) {
      const v = random()
      const color = v < 0.55 ? [4, 4, 6] : v < 0.8 ? [40, 160, 120] : v < 0.95 ? [200, 120, 40] : [230, 230, 240]
      data.set(color, p * 3)
    }
    const colors = extractPalette({ data, width: 100, height: 100, channels: 3 })
    expect(colors[0]).not.toBe("#040406")
    expect(rgbToLab(...(colors[0]!.match(/\w\w/g)!.map((h) => parseInt(h, 16)) as [number, number, number]))[0]).toBeGreaterThan(30)
  })
})

describe("loudest window (GIF fallback)", () => {
  it("finds the loud 4 s burst inside the middle half", () => {
    const sr = 1000
    const signal = new Float32Array(100 * sr).fill(0.01)
    signal.fill(0.9, 5 * sr, 15 * sr) // loud, but in the first quarter: ignored
    signal.fill(0.5, 60 * sr, 64 * sr)
    expect(loudestWindow(signal, sr, 100, 4)).toBeCloseTo(60, 1)
  })
})

describe("GIF framing", () => {
  it("crops a symmetric letterbox or pillarbox and nothing else", () => {
    expect(letterboxCrop(1920, 1080, { w: 1920, h: 816, x: 0, y: 132 })).toBe("1920:816:0:132")
    expect(letterboxCrop(1920, 1080, { w: 1440, h: 1080, x: 240, y: 0 })).toBe("1440:1080:240:0")
    // bars too thin to matter
    expect(letterboxCrop(1920, 1080, { w: 1920, h: 1068, x: 0, y: 6 })).toBeNull()
    // dark top half, not bars
    expect(letterboxCrop(1920, 1080, { w: 1920, h: 900, x: 0, y: 0 })).toBeNull()
    // a visualiser on black: content box in the middle
    expect(letterboxCrop(1920, 1080, { w: 800, h: 600, x: 560, y: 240 })).toBeNull()
    expect(letterboxCrop(1920, 1080, { w: null, h: null, x: null, y: null })).toBeNull()
  })

  it("keeps the chorus start unless a later window is clearly livelier", () => {
    const samples = (fn: (t: number) => number) =>
      Array.from({ length: 48 }, (_, i) => ({ time: 10 + i * 0.25, visibility: fn(10 + i * 0.25) }))
    // title card for the first 4 s, then a lit scene
    const titleCard = samples((t) => (t < 14 ? frameVisibility(30) : frameVisibility(140)))
    expect(pickLiveliest([10, 12, 14, 16], titleCard, 4).index).toBe(2)
    // similar throughout: the chorus start wins
    const even = samples((t) => frameVisibility(t < 14 ? 100 : 110))
    expect(pickLiveliest([10, 12, 14, 16], even, 4).index).toBe(0)
  })

  it("uses the scene-cut measured range for Awaken's Camille & Jhin clip", () => {
    expect(MEASURED_CLIPS["awaken"]).toMatchObject({ youtubeId: "zF5Ddo9JdpY", start: 183.17, end: 189.08 })
  })
})
