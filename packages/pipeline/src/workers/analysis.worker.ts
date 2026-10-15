import { parentPort } from "node:worker_threads"
import { align } from "../analysis/align.ts"
import { analyzeSignal } from "../analysis/audio-analysis.ts"
import { wasmHeapBytes } from "../analysis/essentia.ts"
import { ALIGN_SAMPLE_RATE, alignmentFeatures } from "../analysis/features.ts"
import { pcmFromBytes } from "../analysis/signal.ts"
import type { AlignOutcome, WorkerRequest, WorkerResponse, WorkerTask } from "./protocol.ts"

/**
 * CPU worker for the analysis stages. essentia.js is single-threaded WASM, so
 * the pool runs one of these per core; each owns its own WASM instance.
 */
const port = parentPort
if (!port) throw new Error("analysis.worker.ts must run in a worker thread")

const handle = (task: WorkerTask): unknown => {
  switch (task.kind) {
    case "analyze":
      return analyzeSignal(task.youtubeId, pcmFromBytes(task.pcm))
    case "align": {
      const songSignal = pcmFromBytes(task.song)
      const videoSignal = pcmFromBytes(task.video)
      const song = alignmentFeatures(songSignal)
      const video = alignmentFeatures(videoSignal)
      const result = align(song, video)
      const outcome: AlignOutcome = {
        ...result,
        songDuration: songSignal.length / ALIGN_SAMPLE_RATE,
        videoDuration: videoSignal.length / ALIGN_SAMPLE_RATE,
      }
      return outcome
    }
  }
}

port.on("message", (request: WorkerRequest) => {
  let response: WorkerResponse
  try {
    response = { id: request.id, ok: true, result: handle(request.task), heapBytes: wasmHeapBytes() }
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      fatal: error instanceof WebAssembly.RuntimeError,
      heapBytes: wasmHeapBytes(),
    }
  }
  port.postMessage(response)
})
