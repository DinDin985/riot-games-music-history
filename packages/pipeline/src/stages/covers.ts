import * as NodeFs from "node:fs"
import { Effect, Option, Ref } from "effect"
import sharp, { type Sharp } from "sharp"
import {
  commitTemp,
  coverFile,
  describe,
  isFresh,
  listIds,
  paletteFile,
  progressLogger,
  readCatalog,
  seconds,
  tempPath,
  thumbFile,
  writeJson,
} from "../analysis/media-io.ts"
import { coverBox, detectBars, extractPalette, type RawImage } from "../analysis/palette.ts"
import type { PaletteFile } from "../catalog/types.ts"
import { paths } from "../paths.ts"
import { Command, Flag } from "effect/cli"
import { concurrencyFlag, forceFlag, idListFlag } from "../workers/flags.ts"

export const COVER_SIZE = 600

export interface CoversOptions {
  readonly force: boolean
  /** Every media/thumbs/*.jpg even when the catalog exists. */
  readonly all: boolean
  readonly ids?: ReadonlyArray<string>
  readonly concurrency: number
}

/**
 * `covers`: thumbnail → square album cover + colour palette.
 *
 * Topic art-track thumbnails are the album art centred on a flat-colour 16:9
 * canvas; music-video thumbnails are 16:9 frames (sometimes letterboxed).
 * `coverBox` strips the bars and picks the square; covers that are not square
 * art are cropped by saliency (sharp's "attention" strategy).
 * Outputs: media/covers/<id>.jpg (600×600) and media/analysis/palette/<id>.json.
 */
export const covers = (options: CoversOptions) =>
  Effect.gen(function* () {
    const catalog = yield* readCatalog
    const thumbs = listIds(paths.thumbs, ".jpg")
    const fromCatalog = Option.map(catalog, (c) => [
      ...new Set(c.songs.flatMap((s) => (s.coverYoutubeId ? [s.coverYoutubeId] : []))),
    ])
    const ids =
      options.ids ?? (options.all || Option.isNone(fromCatalog) ? thumbs : Option.getOrElse(fromCatalog, () => thumbs))
    if (!options.ids && Option.isNone(catalog)) {
      yield* Effect.logInfo("covers: data/catalog.json not found — processing every thumbnail")
    }
    const todo = ids.filter(
      (id) =>
        options.force ||
        !isFresh(coverFile(id), [thumbFile(id)]) ||
        !isFresh(paletteFile(id), [thumbFile(id)]),
    )
    const started = Date.now()
    yield* Effect.logInfo(`covers: ${ids.length} covers, ${ids.length - todo.length} up to date, ${todo.length} to render`)
    const stats = yield* Ref.make({ ok: 0, missing: 0, failed: 0, pillarboxed: 0 })
    const tick = progressLogger("covers", todo.length)

    yield* Effect.forEach(
      todo,
      (id) =>
        Effect.tryPromise(() => renderCover(id)).pipe(
          Effect.flatMap((outcome) =>
            Ref.update(stats, (s) =>
              outcome === "missing"
                ? { ...s, missing: s.missing + 1 }
                : { ...s, ok: s.ok + 1, pillarboxed: s.pillarboxed + (outcome === "pillarbox" ? 1 : 0) },
            ),
          ),
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`cover ${id} failed: ${describe(error)}`)),
            ),
          ),
          Effect.andThen(tick()),
        ),
      { concurrency: options.concurrency, discard: true },
    )
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `covers done in ${seconds(started)}: ${s.ok} rendered (${s.pillarboxed} album-art crops), ${s.missing} missing thumbnails, ${s.failed} failed`,
    )
    return s
  })

const toRaw = async (image: Sharp): Promise<RawImage> => {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** Render one cover + palette. */
export const renderCover = async (id: string): Promise<"missing" | "pillarbox" | "square" | "saliency"> => {
  const source = thumbFile(id)
  if (!NodeFs.existsSync(source)) return "missing"
  const input = NodeFs.readFileSync(source)
  const raw = await toRaw(sharp(input))
  const bars = detectBars(raw)
  const { box, square } = coverBox(raw, bars)
  const cropped = sharp(input).extract(box)
  const resized = square
    ? cropped.resize(COVER_SIZE, COVER_SIZE, { fit: "fill", kernel: "lanczos3" })
    : cropped.resize(COVER_SIZE, COVER_SIZE, { fit: "cover", position: sharp.strategy.attention })
  const jpeg = await resized.jpeg({ quality: 88, mozjpeg: true }).toBuffer()

  const out = coverFile(id)
  NodeFs.mkdirSync(paths.covers, { recursive: true })
  const temp = tempPath(out)
  NodeFs.writeFileSync(temp, jpeg)
  commitTemp(temp, out)

  const small = await toRaw(sharp(jpeg).resize(96, 96, { fit: "fill" }))
  const palette: PaletteFile = { youtubeId: id, colors: extractPalette(small) }
  writeJson(paletteFile(id), palette)
  return bars.left > 0 && bars.right > 0 ? "pillarbox" : square ? "square" : "saliency"
}

export const coversCommand = Command.make(
  "covers",
  {
    force: forceFlag,
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Every media/thumbs/*.jpg, not just catalog covers"),
      Flag.withDefault(false),
    ),
    ids: idListFlag("ids", "Only these YouTube ids"),
    concurrency: concurrencyFlag(8, "Covers rendered in parallel"),
  },
  ({ force, all, ids, concurrency }) => covers({ force, all, concurrency, ...(ids ? { ids } : {}) }),
).pipe(Command.withDescription("Thumbnails → media/covers/<id>.jpg (600×600, bars cropped) + colour palettes"))
