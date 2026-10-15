import type { AudioAnalysisFile } from "../catalog/types.ts"
import { type ChorusDebug, type ChorusOptions, findChorusDebug } from "./chorus.ts"
import { ALIGN_SAMPLE_RATE, chromaAndTimbreFrames } from "./features.ts"
import { encodePeaks, loudnessEnvelope, PEAKS_RATE } from "./peaks.ts"
import { extractRhythm, RHYTHM_SAMPLE_RATE } from "./rhythm.ts"
import { decimate2, framePower } from "./signal.ts"

/** Must match `CHROMA_FRAME` / `CHROMA_HOP` in features.ts (frame i centred at i·hop). */
const CHROMA_FRAME = 4096
const CHROMA_HOP = 2048

/** Chorus detection inputs from a 22.05 kHz signal. */
export const chorusFromSignal = (
  signal22k: Float32Array,
  beats: ReadonlyArray<number> = [],
  options: ChorusOptions = {},
): ChorusDebug | null => {
  const { chroma, mfcc } = chromaAndTimbreFrames(signal22k, ALIGN_SAMPLE_RATE)
  const power = framePower(signal22k, CHROMA_FRAME, CHROMA_HOP, chroma.length)
  return findChorusDebug(
    {
      chroma,
      timbre: mfcc,
      power,
      hopSeconds: CHROMA_HOP / ALIGN_SAMPLE_RATE,
      duration: signal22k.length / ALIGN_SAMPLE_RATE,
      beats,
    },
    options,
  )
}

/**
 * Full per-track analysis from a mono 44.1 kHz signal: BPM + beats
 * (RhythmExtractor2013), 50 Hz loudness envelope and chorus.
 */
export const analyzeSignal = (youtubeId: string, signal: Float32Array): AudioAnalysisFile => {
  const rhythm = extractRhythm(signal)
  const peaks = loudnessEnvelope(signal, RHYTHM_SAMPLE_RATE, PEAKS_RATE)
  const chorus = chorusFromSignal(decimate2(signal), rhythm.beats)?.chorus ?? null
  return {
    youtubeId,
    duration: Math.round((signal.length / RHYTHM_SAMPLE_RATE) * 1000) / 1000,
    bpm: rhythm.bpm,
    bpmConfidence: rhythm.confidence,
    beats: rhythm.beats,
    peaks: encodePeaks(peaks),
    peaksRate: PEAKS_RATE,
    chorus,
    analyzedAt: new Date().toISOString(),
  }
}
