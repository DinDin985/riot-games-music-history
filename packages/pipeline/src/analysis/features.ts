import { essentia } from "./essentia.ts"

/** Frame-level features used to align a song with its music video. */
export interface AlignmentFeatures {
  readonly sampleRate: number
  /** Seconds between consecutive chroma frames. */
  readonly hopSeconds: number
  readonly frames: number
  /** `frames × 12` HPCP chroma, mean-centred per track and L2-normalised per frame. */
  readonly chroma: Float32Array
  /** Seconds between consecutive onset-envelope samples (much finer than chroma). */
  readonly onsetHopSeconds: number
  /** Half-wave rectified log-energy derivative, z-normalised. */
  readonly onset: Float32Array
  readonly durationSeconds: number
  /** Signal low-passed and decimated by 4 (~5.5 kHz) for waveform cross-correlation. */
  readonly decimated: Float32Array
  readonly decimatedRate: number
}

export const ALIGN_SAMPLE_RATE = 22050
const CHROMA_FRAME = 4096
const CHROMA_HOP = 2048
const ONSET_FRAME = 512
const ONSET_HOP = 256

/**
 * HPCP chroma via essentia.js: Windowing → Spectrum → SpectralPeaks → HPCP.
 * Chroma is robust to the sound effects, dialogue and remixing that music
 * videos layer on top of the song, while still pinning down harmonic position.
 */
export const chromaFrames = (signal: Float32Array, sampleRate = ALIGN_SAMPLE_RATE): Float32Array[] =>
  spectralFrames(signal, sampleRate, false).chroma

/** Chroma plus 12 MFCCs (c1…c12, timbre) per frame, in one pass. Used by the chorus finder. */
export const chromaAndTimbreFrames = (
  signal: Float32Array,
  sampleRate = ALIGN_SAMPLE_RATE,
): { chroma: Float32Array[]; mfcc: Float32Array[] } => spectralFrames(signal, sampleRate, true)

const spectralFrames = (signal: Float32Array, sampleRate: number, withMfcc: boolean) => {
  const e = essentia()
  const frames = e.FrameGenerator(signal, CHROMA_FRAME, CHROMA_HOP)
  const chroma: Float32Array[] = []
  const mfcc: Float32Array[] = []
  try {
    for (let i = 0; i < frames.size(); i++) {
      const windowed = e.Windowing(frames.get(i), true, CHROMA_FRAME, "blackmanharris62")
      const spectrum = e.Spectrum(windowed.frame, CHROMA_FRAME)
      const peaks = e.SpectralPeaks(spectrum.spectrum, 0.00001, 5000, 100, 40, "magnitude", sampleRate)
      const hpcp = e.HPCP(
        peaks.frequencies,
        peaks.magnitudes,
        true,
        500,
        8,
        5000,
        false,
        40,
        false,
        "unitMax",
        440,
        sampleRate,
        12,
        "squaredCosine",
        1,
      )
      chroma.push(Float32Array.from(e.vectorToArray(hpcp.hpcp)))
      if (withMfcc) {
        const m = e.MFCC(
          spectrum.spectrum,
          2,
          Math.min(11000, sampleRate / 2),
          CHROMA_FRAME / 2 + 1,
          0,
          "dbamp",
          0,
          "unit_sum",
          40,
          13,
          sampleRate,
        )
        // drop c0 (overall level): loudness is scored separately
        mfcc.push(Float32Array.from(e.vectorToArray(m.mfcc)).slice(1))
        m.bands.delete()
        m.mfcc.delete()
      }
      windowed.frame.delete()
      spectrum.spectrum.delete()
      peaks.frequencies.delete()
      peaks.magnitudes.delete()
      hpcp.hpcp.delete()
    }
  } finally {
    frames.delete()
  }
  return { chroma, mfcc }
}

/** Fine-grained onset strength: positive derivative of log RMS energy. */
export const onsetEnvelope = (signal: Float32Array): Float32Array => {
  const count = Math.max(0, Math.floor((signal.length - ONSET_FRAME) / ONSET_HOP) + 1)
  const logEnergy = new Float32Array(count)
  for (let f = 0; f < count; f++) {
    let sum = 0
    const start = f * ONSET_HOP
    for (let k = 0; k < ONSET_FRAME; k++) {
      const v = signal[start + k]!
      sum += v * v
    }
    logEnergy[f] = Math.log(1e-9 + sum / ONSET_FRAME)
  }
  const onset = new Float32Array(count)
  for (let f = 1; f < count; f++) onset[f] = Math.max(0, logEnergy[f]! - logEnergy[f - 1]!)
  return zNormalize(onset)
}

export const zNormalize = (values: Float32Array): Float32Array => {
  let mean = 0
  for (const v of values) mean += v
  mean /= Math.max(1, values.length)
  let variance = 0
  for (const v of values) variance += (v - mean) ** 2
  const std = Math.sqrt(variance / Math.max(1, values.length)) || 1
  return values.map((v) => (v - mean) / std)
}

/** Mean-centre chroma per track (removes key/timbre bias), then L2-normalise each frame. */
export const normalizeChroma = (frames: ReadonlyArray<Float32Array>): Float32Array => {
  const n = frames.length
  const mean = new Float32Array(12)
  for (const frame of frames) for (let c = 0; c < 12; c++) mean[c]! += frame[c]! / Math.max(1, n)
  const out = new Float32Array(n * 12)
  for (let i = 0; i < n; i++) {
    let norm = 0
    for (let c = 0; c < 12; c++) {
      const v = frames[i]![c]! - mean[c]!
      out[i * 12 + c] = v
      norm += v * v
    }
    norm = Math.sqrt(norm) || 1
    for (let c = 0; c < 12; c++) out[i * 12 + c]! /= norm
  }
  return out
}

/** 4-tap box low-pass + decimate by 4. Cheap, and plenty for correlating identical masters. */
export const decimate4 = (signal: Float32Array): Float32Array => {
  const out = new Float32Array(Math.floor(signal.length / 4))
  for (let i = 0; i < out.length; i++) {
    const k = i * 4
    out[i] = (signal[k]! + signal[k + 1]! + signal[k + 2]! + signal[k + 3]!) / 4
  }
  return out
}

export const alignmentFeatures = (signal: Float32Array, sampleRate = ALIGN_SAMPLE_RATE): AlignmentFeatures => {
  const chroma = chromaFrames(signal, sampleRate)
  return {
    decimated: decimate4(signal),
    decimatedRate: sampleRate / 4,
    sampleRate,
    hopSeconds: CHROMA_HOP / sampleRate,
    frames: chroma.length,
    chroma: normalizeChroma(chroma),
    onsetHopSeconds: ONSET_HOP / sampleRate,
    onset: onsetEnvelope(signal),
    durationSeconds: signal.length / sampleRate,
  }
}
