import * as NodeOs from "node:os"
import { Worker } from "node:worker_threads"
import { Context, Data, Effect, Layer } from "effect"
import type { AudioAnalysisFile } from "../catalog/types.ts"
import type { AlignOutcome, WorkerRequest, WorkerResponse, WorkerTask } from "./protocol.ts"

/** A task failed inside a worker (exception, WASM abort or the worker died). */
export class WorkerTaskError extends Data.TaggedError("WorkerTaskError")<{
  readonly kind: WorkerTask["kind"]
  readonly message: string
}> {}

interface Pending {
  readonly id: number
  readonly task: WorkerTask
  readonly transfer: ReadonlyArray<ArrayBuffer>
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

interface Slot {
  readonly worker: Worker
  current: Pending | null
  retired: boolean
}

export interface PoolOptions {
  readonly size: number
  /** Replace a worker once its WASM heap exceeds this (it never shrinks). */
  readonly recycleAboveBytes?: number
}

/**
 * A fixed-size pool of `worker_threads` running `analysis.worker.ts`. Workers
 * start lazily, take one task at a time, and are replaced when they die or
 * their WASM heap grows past `recycleAboveBytes`.
 *
 * Worker threads inherit the parent's `execArgv`, so under `tsx` the worker can
 * be the TypeScript source itself.
 */
export class WorkerPool {
  private readonly slots: Slot[] = []
  private readonly queue: Pending[] = []
  private nextId = 0
  private closed = false

  constructor(
    private readonly script: URL,
    readonly options: PoolOptions,
  ) {}

  run(task: WorkerTask, transfer: ReadonlyArray<ArrayBuffer> = []): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("worker pool is closed"))
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, transfer, resolve, reject })
      this.dispatch()
    })
  }

  async close(): Promise<void> {
    this.closed = true
    for (const pending of this.queue.splice(0)) pending.reject(new Error("worker pool closed"))
    await Promise.all(this.slots.splice(0).map((slot) => slot.worker.terminate()))
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((s) => s.current === null && !s.retired)
      if (!slot) {
        if (this.slots.length >= this.options.size) return
        slot = this.spawn()
      }
      const pending = this.queue.shift()!
      slot.current = pending
      const request: WorkerRequest = { id: pending.id, task: pending.task }
      slot.worker.postMessage(request, [...pending.transfer])
    }
  }

  private spawn(): Slot {
    const worker = new Worker(this.script)
    const slot: Slot = { worker, current: null, retired: false }
    this.slots.push(slot)

    const fail = (error: Error) => {
      const pending = slot.current
      slot.current = null
      pending?.reject(error)
    }
    const retire = () => {
      if (slot.retired) return
      slot.retired = true
      const index = this.slots.indexOf(slot)
      if (index >= 0) this.slots.splice(index, 1)
      void worker.terminate()
    }

    worker.on("message", (response: WorkerResponse) => {
      const pending = slot.current
      slot.current = null
      if (pending && pending.id === response.id) {
        if (response.ok) pending.resolve(response.result)
        else pending.reject(new Error(response.error))
      }
      const recycle = this.options.recycleAboveBytes ?? Number.POSITIVE_INFINITY
      if ((!response.ok && response.fatal) || response.heapBytes > recycle) retire()
      if (!this.closed) this.dispatch()
    })
    worker.on("error", (error) => {
      fail(error)
      retire()
      if (!this.closed) this.dispatch()
    })
    worker.on("exit", (code) => {
      if (slot.current) fail(new Error(`worker exited with code ${code}`))
      retire()
      if (!this.closed) this.dispatch()
    })
    return slot
  }
}

/**
 * Default pool size: ~min(16, cpus − 6) — downloads and other jobs share the
 * machine — further limited by free memory (a busy worker holds ~300 MB:
 * decoded PCM, features and the essentia WASM heap).
 */
export const defaultWorkerCount = (): number => {
  const byCpu = Math.min(16, NodeOs.availableParallelism() - 6)
  const byMemory = Math.floor((NodeOs.freemem() - 1024 ** 3) / (300 * 1024 ** 2))
  return Math.max(2, Math.min(byCpu, byMemory))
}

/** The analysis worker pool as an Effect service. */
export class AnalysisWorkers extends Context.Service<
  AnalysisWorkers,
  {
    readonly size: number
    /** Analyse 44.1 kHz mono f32 PCM (the buffer is transferred to the worker). */
    readonly analyze: (youtubeId: string, pcm: Uint8Array) => Effect.Effect<AudioAnalysisFile, WorkerTaskError>
    /** Align 22.05 kHz mono f32 PCM of a song against a video's audio (buffers transferred). */
    readonly align: (song: Uint8Array, video: Uint8Array) => Effect.Effect<AlignOutcome, WorkerTaskError>
  }
>()("pipeline/AnalysisWorkers") {}

/** A standalone ArrayBuffer holding exactly `bytes` (transferable without dragging a larger buffer along). */
const ownBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer)

export const analysisWorkersLayer = (size: number) =>
  Layer.effect(
    AnalysisWorkers,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WorkerPool(new URL("./analysis.worker.ts", import.meta.url), {
              size,
              recycleAboveBytes: 384 * 1024 ** 2,
            }),
        ),
        (pool) => Effect.promise(() => pool.close()),
      )
      yield* Effect.logInfo(`analysis worker pool: ${size} workers`)
      const run = <A>(task: WorkerTask, transfer: ReadonlyArray<ArrayBuffer>) =>
        Effect.tryPromise({
          try: () => pool.run(task, transfer) as Promise<A>,
          catch: (error) =>
            new WorkerTaskError({
              kind: task.kind,
              message: error instanceof Error ? error.message : String(error),
            }),
        })
      return AnalysisWorkers.of({
        size,
        analyze: (youtubeId, pcm) => {
          const buffer = ownBuffer(pcm)
          return run<AudioAnalysisFile>({ kind: "analyze", youtubeId, pcm: buffer }, [buffer])
        },
        align: (song, video) => {
          const songBuffer = ownBuffer(song)
          const videoBuffer = ownBuffer(video)
          return run<AlignOutcome>({ kind: "align", song: songBuffer, video: videoBuffer }, [songBuffer, videoBuffer])
        },
      })
    }),
  )
