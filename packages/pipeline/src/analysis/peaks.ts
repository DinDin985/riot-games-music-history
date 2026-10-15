import { quantile } from "./signal.ts"

/** Samples per second of the stored loudness envelope (one bar every 20 ms). */
export const PEAKS_RATE = 50

/** RMS below this (≈ −60 dBFS) is drawn as silence. */
const SILENCE_RMS = 1e-3
/**
 * Stevens' power law: perceived loudness ∝ intensity^0.3 = amplitude^0.6.
 * A plain linear RMS makes quiet passages vanish; dB makes everything look
 * equally loud. The 0.6 exponent sits in between and reads like what you hear.
 */
const LOUDNESS_EXPONENT = 0.6
/** Normalise by a high quantile, not the max, so one transient cannot flatten the whole track. */
const NORMALISE_QUANTILE = 0.995

/**
 * Loudness envelope at `rate` Hz: RMS over a Hann window two hops wide centred
 * on each bar's 20 ms slot, perceptually scaled and normalised to 0–255 per
 * track — the loudest part of the track draws at exactly 255.
 *
 * The Hann taper matters: a rectangular window holds a non-integer number of
 * periods of any tone, so a perfectly steady sound would ripple by a level or
 * two from bar to bar (and its loudest bars land just under the reference).
 */
export const loudnessEnvelope = (signal: Float32Array, sampleRate: number, rate = PEAKS_RATE): Uint8Array => {
  const hop = sampleRate / rate
  const count = Math.ceil(signal.length / hop)
  const half = Math.max(1, Math.round(hop))
  const width = 2 * half
  const window = new Float32Array(width)
  for (let k = 0; k < width; k++) window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / width)
  const loudness = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const first = Math.round((i + 0.5) * hop) - half
    const lo = Math.max(0, -first)
    const hi = Math.min(width, signal.length - first)
    let sum = 0
    let weight = 0
    for (let k = lo; k < hi; k++) {
      const v = signal[first + k]!
      sum += window[k]! * v * v
      weight += window[k]!
    }
    const rms = weight > 0 ? Math.sqrt(sum / weight) : 0
    loudness[i] = rms < SILENCE_RMS ? 0 : rms ** LOUDNESS_EXPONENT
  }
  const reference = quantile(loudness, NORMALISE_QUANTILE) || 1
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) out[i] = Math.round(Math.min(1, loudness[i]! / reference) * 255)
  return out
}

/** Base64 for `AudioAnalysisFile.peaks` (decoded by `decodePeaks` in @workspace/db/domain/media). */
export const encodePeaks = (values: Uint8Array): string =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64")
