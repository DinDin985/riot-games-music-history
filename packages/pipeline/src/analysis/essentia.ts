import { createRequire } from "node:module"

/**
 * essentia.js (Essentia compiled to WebAssembly). The Python bindings ship no
 * Windows wheels; the WASM build runs everywhere Node does, including
 * RhythmExtractor2013.
 */
const require = createRequire(import.meta.url)
const { Essentia, EssentiaWASM } = require("essentia.js") as {
  Essentia: new (wasm: unknown) => EssentiaInstance
  EssentiaWASM: { readonly HEAPU8?: Uint8Array }
}

/** The subset of the essentia.js core API the pipeline uses. Vectors must be `.delete()`d. */
export interface WasmVector {
  size(): number
  get(index: number): unknown
  delete(): void
}

export interface EssentiaInstance {
  readonly version: string
  arrayToVector(array: Float32Array): WasmVector
  vectorToArray(vector: WasmVector): Float32Array
  FrameGenerator(signal: Float32Array, frameSize?: number, hopSize?: number): WasmVector
  Windowing(
    frame: unknown,
    normalized?: boolean,
    size?: number,
    type?: string,
  ): { frame: WasmVector }
  Spectrum(frame: WasmVector, size?: number): { spectrum: WasmVector }
  SpectralPeaks(
    spectrum: WasmVector,
    magnitudeThreshold?: number,
    maxFrequency?: number,
    maxPeaks?: number,
    minFrequency?: number,
    orderBy?: string,
    sampleRate?: number,
  ): { frequencies: WasmVector; magnitudes: WasmVector }
  HPCP(
    frequencies: WasmVector,
    magnitudes: WasmVector,
    bandPreset?: boolean,
    bandSplitFrequency?: number,
    harmonics?: number,
    maxFrequency?: number,
    maxShifted?: boolean,
    minFrequency?: number,
    nonLinear?: boolean,
    normalized?: string,
    referenceFrequency?: number,
    sampleRate?: number,
    size?: number,
    weightType?: string,
    windowSize?: number,
  ): { hpcp: WasmVector }
  MFCC(
    spectrum: WasmVector,
    dctType?: number,
    highFrequencyBound?: number,
    inputSize?: number,
    liftering?: number,
    logType?: string,
    lowFrequencyBound?: number,
    normalize?: string,
    numberBands?: number,
    numberCoefficients?: number,
    sampleRate?: number,
  ): { bands: WasmVector; mfcc: WasmVector }
  RhythmExtractor2013(
    signal: WasmVector,
    maxTempo?: number,
    method?: string,
    minTempo?: number,
  ): {
    bpm: number
    ticks: WasmVector
    confidence: number
    estimates: WasmVector
    bpmIntervals: WasmVector
  }
}

let instance: EssentiaInstance | undefined

export const essentia = (): EssentiaInstance => (instance ??= new Essentia(EssentiaWASM))

/**
 * Current size of the WASM heap. It never shrinks (one 9-minute track takes it
 * to ~0.5 GB), so the worker pool recycles workers whose heap grew large.
 */
export const wasmHeapBytes = (): number => EssentiaWASM.HEAPU8?.length ?? 0
