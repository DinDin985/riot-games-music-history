import type { AlignResult } from "../analysis/align.ts"
import type { AudioAnalysisFile } from "../catalog/types.ts"

/**
 * Messages between the stages (main thread) and `analysis.worker.ts`.
 * PCM travels as transferred `ArrayBuffer`s of little-endian f32 mono samples,
 * so handing a decoded track to a worker costs no copy.
 */
export type WorkerTask =
  | {
      readonly kind: "analyze"
      readonly youtubeId: string
      /** 44.1 kHz mono f32. */
      readonly pcm: ArrayBuffer
    }
  | {
      readonly kind: "align"
      /** 22.05 kHz mono f32 of the released track. */
      readonly song: ArrayBuffer
      /** 22.05 kHz mono f32 of the music video's audio stream. */
      readonly video: ArrayBuffer
    }

export interface AlignOutcome extends AlignResult {
  /** Seconds of decoded audio. */
  readonly songDuration: number
  readonly videoDuration: number
}

export interface WorkerResults {
  readonly analyze: AudioAnalysisFile
  readonly align: AlignOutcome
}

export type ResultOf<T extends WorkerTask> = WorkerResults[T["kind"]]

export interface WorkerRequest {
  readonly id: number
  readonly task: WorkerTask
}

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown; readonly heapBytes: number }
  | {
      readonly id: number
      readonly ok: false
      readonly error: string
      /** The WASM runtime aborted: the worker must be replaced. */
      readonly fatal: boolean
      readonly heapBytes: number
    }
