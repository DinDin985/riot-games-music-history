/**
 * Small DSP helpers shared by the analysis stages. Pure functions over mono
 * Float32 PCM; no WASM.
 */

/** View raw little-endian f32 PCM bytes (ffmpeg `-f f32le`) as samples without copying when aligned. */
export const pcmFromBytes = (bytes: Uint8Array | ArrayBuffer): Float32Array => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const usable = view.byteLength - (view.byteLength % 4)
  if (view.byteOffset % 4 === 0) return new Float32Array(view.buffer, view.byteOffset, usable / 4)
  return new Float32Array(view.slice(0, usable).buffer)
}

/**
 * 31-tap windowed-sinc half-band low-pass, then keep every second sample.
 * Used to derive the 22.05 kHz signal (chroma, alignment) from the 44.1 kHz
 * decode (RhythmExtractor2013 only accepts 44.1 kHz) without a second ffmpeg run.
 */
const HALF_BAND: Float32Array = (() => {
  const taps = 31
  const mid = (taps - 1) / 2
  const out = new Float32Array(taps)
  let sum = 0
  for (let n = 0; n < taps; n++) {
    const k = n - mid
    const sinc = k === 0 ? 0.5 : Math.sin((Math.PI * k) / 2) / (Math.PI * k)
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1))
    out[n] = sinc * blackman
    sum += out[n]!
  }
  for (let n = 0; n < taps; n++) out[n]! /= sum
  return out
})()

export const decimate2 = (signal: Float32Array): Float32Array => {
  const taps = HALF_BAND.length
  const mid = (taps - 1) / 2
  const out = new Float32Array(Math.floor(signal.length / 2))
  const last = signal.length - 1
  for (let i = 0; i < out.length; i++) {
    const center = i * 2
    let acc = 0
    if (center - mid >= 0 && center + mid <= last) {
      for (let n = 0; n < taps; n++) acc += HALF_BAND[n]! * signal[center - mid + n]!
    } else {
      for (let n = 0; n < taps; n++) {
        const k = Math.min(last, Math.max(0, center - mid + n))
        acc += HALF_BAND[n]! * signal[k]!
      }
    }
    out[i] = acc
  }
  return out
}

/**
 * Mean power of `frameSize`-sample frames centred on `i * hop` (zero padded at
 * the edges) — the same framing as essentia's FrameGenerator, so frame `i`
 * lines up with chroma frame `i`.
 */
export const framePower = (signal: Float32Array, frameSize: number, hop: number, frames?: number): Float32Array => {
  const count = frames ?? Math.floor(signal.length / hop) + 1
  const out = new Float32Array(count)
  const half = Math.floor(frameSize / 2)
  for (let f = 0; f < count; f++) {
    const start = Math.max(0, f * hop - half)
    const end = Math.min(signal.length, f * hop - half + frameSize)
    let sum = 0
    for (let k = start; k < end; k++) sum += signal[k]! * signal[k]!
    out[f] = sum / frameSize
  }
  return out
}

/** Value at quantile `q` (0–1) of `values` (copy-sorted). */
export const quantile = (values: ArrayLike<number>, q: number): number => {
  if (values.length === 0) return 0
  const sorted = Float64Array.from(values).sort()
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[at]!
}
