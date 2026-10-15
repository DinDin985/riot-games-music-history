import { Data, Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** A child process exited with a non-zero code. `output` holds the tail of stdout+stderr. */
export class ProcessError extends Data.TaggedError("ProcessError")<{
  readonly command: string
  readonly exitCode: number
  readonly output: string
}> {}

/**
 * Run an executable to completion and return its combined stdout+stderr.
 * Fails with `ProcessError` when the exit code is non-zero.
 */
export const run = Effect.fn("Process.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: ChildProcess.CommandOptions,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, options))
      const [output, exitCode] = yield* Effect.all(
        [handle.all.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
        { concurrency: 2 },
      )
      if (exitCode !== 0) {
        return yield* new ProcessError({
          command: [command, ...args].join(" "),
          exitCode,
          output: output.slice(-4000),
        })
      }
      return output
    }),
  )
})

/**
 * Run an executable and return its raw stdout bytes (e.g. `ffmpeg … -f f32le -`
 * PCM). The chunks are concatenated into one fresh, transferable `ArrayBuffer`.
 */
export const runBytes = Effect.fn("Process.runBytes")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: ChildProcess.CommandOptions,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, options))
      const [chunks, stderr, exitCode] = yield* Effect.all(
        [
          Stream.runCollect(handle.stdout),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      )
      if (exitCode !== 0) {
        return yield* new ProcessError({
          command: [command, ...args].join(" "),
          exitCode,
          output: stderr.slice(-4000),
        })
      }
      let length = 0
      for (const chunk of chunks) length += chunk.byteLength
      const bytes = new Uint8Array(length)
      let at = 0
      for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.byteLength
      }
      return bytes
    }),
  )
})

/** Run an executable and return stdout only (stderr is discarded). */
export const runStdout = Effect.fn("Process.runStdout")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: ChildProcess.CommandOptions,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, options))
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      )
      if (exitCode !== 0) {
        return yield* new ProcessError({
          command: [command, ...args].join(" "),
          exitCode,
          output: stderr.slice(-4000),
        })
      }
      return stdout
    }),
  )
})

/**
 * Run an executable and return stdout, stderr and the exit code without failing
 * on a non-zero exit — for tools like `yt-dlp --ignore-errors` that print useful
 * output for the entries that worked and exit 1 because some did not.
 */
export const runLenient = Effect.fn("Process.runLenient")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: ChildProcess.CommandOptions,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, options))
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      )
      return { stdout, stderr, exitCode: Number(exitCode) }
    }),
  )
})
