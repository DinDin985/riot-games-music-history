import { essentia } from "./essentia.ts"

/** RhythmExtractor2013 only supports 44.1 kHz input. */
export const RHYTHM_SAMPLE_RATE = 44100

/** Upper bound of RhythmExtractor2013's "multifeature" confidence (essentia docs). */
const MAX_MULTIFEATURE_CONFIDENCE = 5.32

export interface RhythmResult {
  readonly bpm: number | null
  /** 0–1: the multifeature confidence (0…5.32) divided by its maximum. ≥ 0.28 is "good" per essentia. */
  readonly confidence: number | null
  /** Beat positions, seconds, rounded to ms. */
  readonly beats: ReadonlyArray<number>
}

/**
 * BPM and beat positions via essentia.js RhythmExtractor2013 (method
 * "multifeature", 40–208 BPM). Every WASM vector is freed: essentia.js does not
 * garbage collect them, and a worker analysing hundreds of tracks would
 * otherwise grow without bound.
 */
export const extractRhythm = (signal: Float32Array): RhythmResult => {
  if (signal.length < RHYTHM_SAMPLE_RATE * 4) return { bpm: null, confidence: null, beats: [] }
  const e = essentia()
  const input = e.arrayToVector(signal)
  try {
    const result = e.RhythmExtractor2013(input, 208, "multifeature", 40)
    try {
      const ticks = e.vectorToArray(result.ticks)
      const beats = Array.from(ticks, (t) => Math.round(t * 1000) / 1000)
      const bpm = Number.isFinite(result.bpm) && result.bpm > 0 ? Math.round(result.bpm * 100) / 100 : null
      const confidence = Number.isFinite(result.confidence)
        ? Math.round(Math.max(0, Math.min(1, result.confidence / MAX_MULTIFEATURE_CONFIDENCE)) * 1000) / 1000
        : null
      return { bpm, confidence: bpm === null ? null : confidence, beats }
    } finally {
      result.ticks.delete()
      result.estimates.delete()
      result.bpmIntervals.delete()
    }
  } finally {
    input.delete()
  }
}
