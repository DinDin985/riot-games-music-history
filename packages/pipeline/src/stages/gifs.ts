import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { type Alignment, identityAlignment, songToVideo } from "@workspace/db/domain/alignment"
import { Effect, Option, Ref } from "effect"
import {
  alignFile,
  analysisFile,
  clipFile,
  clipInfoFile,
  commitTemp,
  decodePcm,
  describe,
  exists,
  ffmpeg,
  gifFile,
  gifInfoFile,
  isFresh,
  probe,
  progressLogger,
  readCatalog,
  readJson,
  removeQuietly,
  seconds,
  tempPath,
  writeJson,
} from "../analysis/media-io.ts"
import { pcmFromBytes } from "../analysis/signal.ts"
import type { AlignmentFile, AudioAnalysisFile, CatalogSong } from "../catalog/types.ts"
import { paths, videoFile } from "../paths.ts"
import { runStdout } from "../services/Process.ts"
import { Command, Flag } from "effect/cli"
import { concurrencyFlag, forceFlag, idListFlag } from "../workers/flags.ts"
import { defaultWorkerCount } from "../workers/pool.ts"

export const GIF_SECONDS = 4
const MAX_GIF_BYTES = 3 * 1024 * 1024
/** Successively cheaper renders, tried until the GIF fits in MAX_GIF_BYTES. */
const GIF_LADDER = [
  { scale: 1, fps: 12 },
  { scale: 1, fps: 10 },
  { scale: 0.85, fps: 10 },
  { scale: 0.75, fps: 8 },
  { scale: 0.66, fps: 8 },
  { scale: 0.5, fps: 6 },
] as const
/** Ignore alignments that matched less than this share of the song. */
const MIN_ALIGNMENT_COVERAGE = 0.15
const ENVELOPE_RATE = 8000

/** `media/analysis/gif/<songId>.json` — what the song's GIF shows. */
export interface GifInfoFile {
  readonly songId: string
  readonly videoId: string
  /** Video time (s) where the GIF starts. */
  readonly videoStart: number
  readonly duration: number
  /** `chorus` = analysed chorus mapped through the alignment; `loudest` = fallback. */
  readonly source: "chorus" | "loudest"
  readonly songTime: number | null
  /** ffmpeg crop (`w:h:x:y`) removing the video's letterbox/pillarbox bars, or null when it has none. */
  readonly crop: string | null
  /** 0–1: how much the window shows (see `liveliestMoment`); null when there was nothing to choose from. */
  readonly visual: number | null
  readonly width: number
  readonly fps: number
  readonly bytes: number
}

/** `media/analysis/clips/<slug>.json` — parameters of a rendered impact clip. */
export interface ClipInfoFile {
  readonly slug: string
  readonly youtubeId: string
  readonly start: number
  readonly end: number
  readonly gif: { readonly width: number; readonly fps: number; readonly bytes: number }
  readonly mp4Bytes: number
}

interface FeaturedClip {
  readonly youtubeId: string
  readonly start: number
  readonly end: number
}

export interface GifsOptions {
  readonly force: boolean
  readonly concurrency: number
  readonly songs?: ReadonlyArray<string>
  /** Skip the impact clips. */
  readonly skipClips: boolean
}

/**
 * `gifs`: a 4 s looping GIF of each song's music video at the chorus, plus the
 * impact stories' featured clips (MP4 + GIF).
 *
 * The chorus moment is the analysed chorus (song time) mapped into the video by
 * the audio alignment (identity when the song's audio is the video's): the
 * chorus start, unless a later 4 s of the same chorus shows clearly more (the
 * start lands on a black frame or a title card). Without a usable
 * chorus/alignment, the loudest sustained 4 s in the middle half of the video
 * stands in. Letterbox bars are cropped away. A sidecar in media/analysis/gif/
 * records the moment and crop, so a changed chorus or alignment re-renders and
 * nothing else does.
 */
export const gifs = (options: GifsOptions) =>
  Effect.gen(function* () {
    const catalog = yield* readCatalog
    const started = Date.now()
    const stats = yield* Ref.make({ rendered: 0, chorus: 0, loudest: 0, upToDate: 0, missing: 0, failed: 0 })

    if (Option.isNone(catalog)) {
      yield* Effect.logWarning("gifs: data/catalog.json not found — song GIFs skipped (run `catalog` first)")
    } else {
      const wanted = options.songs ? new Set(options.songs) : null
      const songs = catalog.value.songs.filter((s) => s.musicVideo && (!wanted || wanted.has(s.id)))
      yield* Effect.logInfo(`gifs: ${songs.length} songs with a music video`)
      const tick = progressLogger("gifs", songs.length)
      yield* Effect.forEach(
        songs,
        (song) =>
          songGif(song, options.force).pipe(
            Effect.flatMap((outcome) =>
              Ref.update(stats, (s) => {
                if (outcome === "missing") return { ...s, missing: s.missing + 1 }
                if (outcome === "fresh") return { ...s, upToDate: s.upToDate + 1 }
                return { ...s, rendered: s.rendered + 1, [outcome]: s[outcome] + 1 }
              }),
            ),
            Effect.catch((error) =>
              Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
                Effect.andThen(Effect.logWarning(`gif ${song.id} failed: ${describe(error)}`)),
              ),
            ),
            Effect.andThen(tick()),
          ),
        { concurrency: options.concurrency, discard: true },
      )
    }
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `gifs done in ${seconds(started)}: ${s.rendered} rendered (${s.chorus} at the chorus, ${s.loudest} loudest-4s fallback), ${s.upToDate} up to date, ${s.missing} without video, ${s.failed} failed`,
    )
    const clips = options.skipClips ? null : yield* impactClips(options)
    return { ...s, clips }
  })

// --- song GIFs ---------------------------------------------------------------

const songGif = (song: CatalogSong, force: boolean) =>
  Effect.gen(function* () {
    const videoId = song.musicVideo!.youtubeId
    const video = videoFile(videoId)
    if (!exists(video)) return "missing" as const
    const info = yield* probe(video)
    const duration = info.duration ?? 0
    const crop = yield* activeArea(video, info.width, info.height)

    const out = gifFile(song.id)
    const previous = readJson<GifInfoFile>(gifInfoFile(song.id))
    const upToDate = (moment: Moment) =>
      !force &&
      previous !== null &&
      previous.videoId === videoId &&
      previous.crop === crop &&
      Math.abs(previous.videoStart - moment.videoStart) < 0.05 &&
      isFresh(out, [video])

    const candidates = chorusMoments(song, duration)
    let moment: Moment
    if (candidates.length === 0) moment = yield* loudestMoment(video, duration)
    else if (candidates.length === 1) moment = candidates[0]!
    else {
      // the previous pick is still one of the candidates and was chosen the same way: no need to look again
      const kept =
        previous && typeof previous.visual === "number"
          ? candidates.find((c) => Math.abs(c.videoStart - previous.videoStart) < 0.05)
          : undefined
      moment =
        kept && upToDate(kept)
          ? { ...kept, visual: previous!.visual }
          : yield* liveliestMoment(video, candidates, crop)
    }
    if (upToDate(moment)) return "fresh" as const

    const rendered = yield* renderGif(video, moment.videoStart, GIF_SECONDS, 480, out, crop)
    const sidecar: GifInfoFile = {
      songId: song.id,
      videoId,
      videoStart: moment.videoStart,
      duration: GIF_SECONDS,
      source: moment.source,
      songTime: moment.songTime,
      crop,
      visual: moment.visual ?? null,
      ...rendered,
    }
    writeJson(gifInfoFile(song.id), sidecar)
    return moment.source
  })

interface Moment {
  readonly videoStart: number
  readonly source: "chorus" | "loudest"
  readonly songTime: number | null
  readonly visual?: number | null
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Every GIF window the analysed chorus offers, in song order: starts 1 s apart
 * across the chorus whose next GIF_SECONDS the video plays without a cut (one
 * alignment segment). Falls back to the chorus start alone when it is mapped
 * but no window is uncut; empty without an analysed chorus or a usable alignment.
 */
export const chorusMoments = (song: CatalogSong, videoDuration: number): ReadonlyArray<Moment> => {
  if (!song.audio || !song.musicVideo) return []
  const analysis = readJson<AudioAnalysisFile>(analysisFile(song.audio.youtubeId))
  if (!analysis?.chorus) return []
  const identity = song.audio.kind === "music_video" || song.audio.youtubeId === song.musicVideo.youtubeId
  const alignment: Pick<Alignment, "segments" | "coverage"> | null = identity
    ? identityAlignment(song.id, song.musicVideo.youtubeId, analysis.duration)
    : readJson<AlignmentFile>(alignFile(song.id, song.musicVideo.youtubeId))
  if (!alignment || alignment.coverage < MIN_ALIGNMENT_COVERAGE) return []
  const { start, end } = analysis.chorus
  const momentAt = (songTime: number, uncut: boolean): Moment | null => {
    const mapped = songToVideo(alignment, songTime)
    if (mapped.kind !== "exact") return null
    if (uncut) {
      const after = songToVideo(alignment, songTime + GIF_SECONDS - 0.05)
      if (after.kind !== "exact" || after.segmentIndex !== mapped.segmentIndex) return null
    }
    if (videoDuration > 0 && mapped.videoTime + GIF_SECONDS > videoDuration) return null
    return { videoStart: round3(Math.max(0, mapped.videoTime)), source: "chorus", songTime: round3(songTime) }
  }
  const moments: Moment[] = []
  for (let songTime = start; songTime === start || songTime + GIF_SECONDS <= end + 1e-6; songTime += 1) {
    const moment = momentAt(songTime, true)
    if (moment) moments.push(moment)
  }
  if (moments.length > 0) return moments
  const fallback = momentAt(start, false)
  return fallback ? [fallback] : []
}

/** The first chorus window (normally the chorus start): what the GIF shows unless a later one is livelier. */
export const chorusMoment = (song: CatalogSong, videoDuration: number): Moment | null =>
  chorusMoments(song, videoDuration)[0] ?? null

/** Bars narrower than this share of the frame are left alone; wider than the maximum is not a letterbox. */
const MIN_BAR_SHARE = 0.04
const MAX_BAR_SHARE = 0.35

/**
 * The video's active picture as an ffmpeg crop (`w:h:x:y`), or null when it
 * fills the frame. ffmpeg's cropdetect over the keyframes only (fast), never
 * resetting — so the box is the union of everything the video ever shows and a
 * dark scene cannot be mistaken for bars.
 */
export const activeArea = (video: string, width: number | null, height: number | null) =>
  runStdout("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-skip_frame",
    "nokey",
    "-i",
    video,
    "-an",
    "-vf",
    "cropdetect=limit=24:round=2:reset=0,metadata=print:file=-",
    "-f",
    "null",
    "-",
  ]).pipe(
    Effect.map((stdout) => {
      if (!width || !height) return null
      const last = (key: string): number | null => {
        const matches = [...stdout.matchAll(new RegExp(`lavfi\\.cropdetect\\.${key}=(-?\\d+)`, "g"))]
        const value = matches.length > 0 ? Number(matches[matches.length - 1]![1]) : Number.NaN
        return Number.isFinite(value) ? value : null
      }
      return letterboxCrop(width, height, { w: last("w"), h: last("h"), x: last("x"), y: last("y") })
    }),
    // a video whose bars cannot be measured is rendered uncropped
    Effect.catch(() => Effect.succeed(null)),
  )

/**
 * Pure: cropdetect's box → crop string when it is a symmetric letterbox (full
 * width) or pillarbox (full height) worth removing. Anything else — a
 * visualiser on a black background, say — is left as it is.
 */
export const letterboxCrop = (
  width: number,
  height: number,
  box: { readonly w: number | null; readonly h: number | null; readonly x: number | null; readonly y: number | null },
): string | null => {
  const { w, h, x, y } = box
  if (w === null || h === null || x === null || y === null || w <= 0 || h <= 0) return null
  const tolerance = Math.max(4, Math.round(Math.max(width, height) * 0.005))
  const top = y
  const bottom = height - (y + h)
  const left = x
  const right = width - (x + w)
  const barsY = (height - h) / height
  const barsX = (width - w) / width
  const fullWidth = left <= tolerance && right <= tolerance
  const fullHeight = top <= tolerance && bottom <= tolerance
  if (fullWidth && Math.abs(top - bottom) <= tolerance && barsY >= MIN_BAR_SHARE && barsY <= MAX_BAR_SHARE) {
    return `${width}:${h}:0:${y}`
  }
  if (fullHeight && Math.abs(left - right) <= tolerance && barsX >= MIN_BAR_SHARE && barsX <= MAX_BAR_SHARE) {
    return `${w}:${height}:${x}:0`
  }
  return null
}

/** Frames per second sampled when judging what a window shows. */
const VISUAL_SAMPLE_FPS = 4
/** A later chorus window must look this much livelier than the first to replace it. */
const VISUAL_PREFERENCE = 0.15
/** Longest stretch of video sampled to choose between chorus windows. */
const VISUAL_MAX_SPAN = 40

/**
 * Pure: how much one sampled frame shows, 0–1, from its 90th-percentile luma
 * (signalstats YHIGH, 8-bit): a black frame or a line of text on black stays
 * dark even at the 90th percentile; a lit scene does not.
 */
export const frameVisibility = (yHigh: number): number => Math.max(0, Math.min(1, (yHigh - 32) / 96))

/** Pure: mean visibility of the samples inside each window; the first wins unless another is clearly livelier. */
export const pickLiveliest = (
  starts: ReadonlyArray<number>,
  samples: ReadonlyArray<{ readonly time: number; readonly visibility: number }>,
  windowSeconds: number,
): { readonly index: number; readonly scores: ReadonlyArray<number> } => {
  const scores = starts.map((start) => {
    const inside = samples.filter((s) => s.time >= start - 1e-6 && s.time < start + windowSeconds - 1e-6)
    return inside.length === 0 ? 0 : inside.reduce((sum, s) => sum + s.visibility, 0) / inside.length
  })
  let best = 0
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i
  return { index: scores[0]! >= scores[best]! - VISUAL_PREFERENCE ? 0 : best, scores }
}

/**
 * Of several chorus windows, the one that shows the most (`frameVisibility`),
 * preferring the chorus start. One ffmpeg pass samples the span at 4 fps,
 * small, after the letterbox crop.
 */
const liveliestMoment = (video: string, candidates: ReadonlyArray<Moment>, crop: string | null) => {
  const from = candidates[0]!.videoStart
  const usable = candidates.filter((c) => c.videoStart >= from && c.videoStart - from <= VISUAL_MAX_SPAN)
  const to = Math.max(...usable.map((c) => c.videoStart)) + GIF_SECONDS
  const filter =
    `fps=${VISUAL_SAMPLE_FPS},${crop ? `crop=${crop},` : ""}scale=160:-2,` +
    "signalstats,metadata=print:key=lavfi.signalstats.YHIGH:file=-"
  return runStdout("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-ss",
    from.toFixed(3),
    "-t",
    (to - from).toFixed(3),
    "-i",
    video,
    "-an",
    "-vf",
    filter,
    "-f",
    "null",
    "-",
  ]).pipe(
    Effect.map((stdout): Moment => {
      const samples: Array<{ time: number; visibility: number }> = []
      let time: number | null = null
      for (const line of stdout.split(/\r?\n/)) {
        const pts = /pts_time:(-?[\d.]+)/.exec(line)
        if (pts) {
          time = from + Number(pts[1])
          continue
        }
        const y = /lavfi\.signalstats\.YHIGH=([\d.]+)/.exec(line)
        if (y && time !== null) samples.push({ time, visibility: frameVisibility(Number(y[1])) })
      }
      const { index, scores } = pickLiveliest(
        usable.map((c) => c.videoStart),
        samples,
        GIF_SECONDS,
      )
      return { ...usable[index]!, visual: Math.round(scores[index]! * 1000) / 1000 }
    }),
    Effect.catch(() => Effect.succeed(candidates[0]!)),
  )
}

/** Start of the loudest sustained `GIF_SECONDS` in the middle half of the video's audio. */
const loudestMoment = (video: string, duration: number) =>
  decodePcm(video, ENVELOPE_RATE).pipe(
    Effect.map((bytes): Moment => {
      const signal = pcmFromBytes(bytes)
      const total = duration > 0 ? duration : signal.length / ENVELOPE_RATE
      return { videoStart: round3(loudestWindow(signal, ENVELOPE_RATE, total, GIF_SECONDS)), source: "loudest", songTime: null }
    }),
  )

/** Pure: window start (s) maximising mean energy, restricted to [25 %, 75 %] of the track. */
export const loudestWindow = (signal: Float32Array, sampleRate: number, duration: number, windowSeconds: number) => {
  const hop = Math.round(sampleRate / 10)
  const frames = Math.floor(signal.length / hop)
  const energy = new Float64Array(frames + 1)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let k = f * hop; k < (f + 1) * hop; k++) sum += signal[k]! * signal[k]!
    energy[f + 1] = energy[f]! + sum / hop
  }
  const width = Math.round(windowSeconds * 10)
  const lo = Math.floor(duration * 0.25 * 10)
  const hi = Math.min(frames - width, Math.floor(duration * 0.75 * 10) - width)
  if (hi < lo) return Math.max(0, duration / 2 - windowSeconds / 2)
  let best = lo
  for (let f = lo; f <= hi; f++) if (energy[f + width]! - energy[f]! > energy[best + width]! - energy[best]!) best = f
  return best / 10
}

/**
 * Keep exactly the frames whose timestamps fall in [start, start + duration)
 * (after an input seek, frame times are relative to the seek point) and restart
 * the clock at the first one. A bare `-t` lets ffmpeg's frame-rate rounding
 * slip in the first frame of the next shot — a one-frame flash at a loop point.
 */
const exactSpan = (duration: number) => `trim=start=0:end=${duration.toFixed(3)},setpts=PTS-STARTPTS`

/**
 * Render a looping GIF: palettegen (stats_mode=diff: palette tuned to what
 * moves) + paletteuse (ordered bayer dither — compresses far better than error
 * diffusion and doesn't crawl between frames), after an optional letterbox
 * crop. Steps down fps/width until the file is ≤ 3 MB.
 */
export const renderGif = (
  video: string,
  start: number,
  duration: number,
  width: number,
  out: string,
  crop: string | null = null,
) =>
  Effect.gen(function* () {
    NodeFs.mkdirSync(NodePath.dirname(out), { recursive: true })
    const temp = tempPath(out)
    let last = { width, fps: 12, bytes: 0 }
    for (const step of GIF_LADDER) {
      const w = Math.round((width * step.scale) / 2) * 2
      const filter =
        `[0:v]${exactSpan(duration)},${crop ? `crop=${crop},` : ""}` +
        `fps=${step.fps},scale=${w}:-2:flags=lanczos,split[a][b];` +
        `[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`
      yield* ffmpeg([
        "-ss",
        start.toFixed(3),
        "-t",
        (duration + 0.25).toFixed(3),
        "-i",
        video,
        "-filter_complex",
        filter,
        "-an",
        "-loop",
        "0",
        temp,
      ]).pipe(Effect.tapError(() => Effect.sync(() => removeQuietly(temp))))
      last = { width: w, fps: step.fps, bytes: NodeFs.statSync(temp).size }
      if (last.bytes <= MAX_GIF_BYTES) break
    }
    commitTemp(temp, out)
    return last
  })

// --- impact clips ------------------------------------------------------------

/**
 * Featured-clip ranges measured by scene-cut detection on the downloaded video
 * (`ffmpeg -vf "select='gt(scene,0.2)',metadata=print"`). They start and end
 * exactly on the scene's cuts, so they win over a story's hand-noted range for
 * the same video when the two disagree.
 */
export const MEASURED_CLIPS: Readonly<Record<string, FeaturedClip & { readonly scenes: string }>> = {
  awaken: {
    youtubeId: "zF5Ddo9JdpY",
    start: 183.17,
    end: 189.08,
    scenes:
      "cuts at 183.167 (Jhin mask close-up), 184.750 (Camille in smoke), 186.375 (Camille leaps over conducting Jhin), 189.083 (cut to Draven)",
  },
}

const readFeaturedClips = (): ReadonlyArray<{ slug: string; clip: FeaturedClip; overridden?: FeaturedClip }> => {
  const dir = NodePath.join(paths.curated, "impact")
  let files: string[] = []
  try {
    files = NodeFs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return []
  }
  return files.flatMap((file) => {
    const story = readJson<{ slug?: string; featuredClip?: Partial<FeaturedClip> | null }>(NodePath.join(dir, file))
    const clip = story?.featuredClip
    if (!clip || typeof clip.youtubeId !== "string" || typeof clip.start !== "number" || typeof clip.end !== "number")
      return []
    if (!(clip.end > clip.start)) return []
    const slug = story.slug ?? file.replace(/\.json$/, "")
    const curated = { youtubeId: clip.youtubeId, start: clip.start, end: clip.end }
    const measured = MEASURED_CLIPS[slug]
    if (
      measured &&
      measured.youtubeId === curated.youtubeId &&
      (Math.abs(measured.start - curated.start) > 0.005 || Math.abs(measured.end - curated.end) > 0.005)
    ) {
      const exact = { youtubeId: measured.youtubeId, start: measured.start, end: measured.end }
      return [{ slug, clip: exact, overridden: curated }]
    }
    return [{ slug, clip: curated }]
  })
}

/**
 * Impact stories' featured clips: `media/clips/<slug>.mp4` (H.264 ≤720p,
 * muted, +faststart — autoplays inline) and `media/clips/<slug>.gif` (540 px).
 * Re-rendered when the curated start/end/video change.
 */
const impactClips = (options: GifsOptions) =>
  Effect.gen(function* () {
    const clips = readFeaturedClips()
    const stats = yield* Ref.make({ rendered: 0, upToDate: 0, missing: 0, failed: 0 })
    yield* Effect.logInfo(`clips: ${clips.length} impact stories with a featured clip`)
    yield* Effect.forEach(
      clips,
      ({ slug, clip, overridden }) =>
        Effect.gen(function* () {
          if (overridden) {
            yield* Effect.logInfo(
              `clip ${slug}: curated ${overridden.start}–${overridden.end} s → scene-cut measured ${clip.start}–${clip.end} s`,
            )
          }
          const video = videoFile(clip.youtubeId)
          if (!exists(video)) {
            yield* Effect.logWarning(`clip ${slug}: video ${clip.youtubeId} is not downloaded`)
            yield* Ref.update(stats, (s) => ({ ...s, missing: s.missing + 1 }))
            return
          }
          const mp4 = clipFile(slug, "mp4")
          const gif = clipFile(slug, "gif")
          const previous = readJson<ClipInfoFile>(clipInfoFile(slug))
          if (
            !options.force &&
            previous?.youtubeId === clip.youtubeId &&
            previous.start === clip.start &&
            previous.end === clip.end &&
            isFresh(mp4, [video]) &&
            isFresh(gif, [video])
          ) {
            yield* Ref.update(stats, (s) => ({ ...s, upToDate: s.upToDate + 1 }))
            return
          }
          const duration = clip.end - clip.start
          NodeFs.mkdirSync(paths.clips, { recursive: true })
          const temp = tempPath(mp4)
          yield* ffmpeg([
            "-ss",
            clip.start.toFixed(3),
            "-t",
            (duration + 0.25).toFixed(3),
            "-i",
            video,
            "-an",
            "-vf",
            `${exactSpan(duration)},scale=-2:'min(720,ih)':flags=lanczos`,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "21",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            temp,
          ]).pipe(Effect.tapError(() => Effect.sync(() => removeQuietly(temp))))
          commitTemp(temp, mp4)
          const rendered = yield* renderGif(video, clip.start, duration, 540, gif)
          const info: ClipInfoFile = {
            slug,
            youtubeId: clip.youtubeId,
            start: clip.start,
            end: clip.end,
            gif: rendered,
            mp4Bytes: NodeFs.statSync(mp4).size,
          }
          writeJson(clipInfoFile(slug), info)
          yield* Ref.update(stats, (s) => ({ ...s, rendered: s.rendered + 1 }))
        }).pipe(
          Effect.catch((error) =>
            Ref.update(stats, (s) => ({ ...s, failed: s.failed + 1 })).pipe(
              Effect.andThen(Effect.logWarning(`clip ${slug} failed: ${describe(error)}`)),
            ),
          ),
        ),
      { concurrency: options.concurrency, discard: true },
    )
    const s = yield* Ref.get(stats)
    yield* Effect.logInfo(
      `clips: ${s.rendered} rendered, ${s.upToDate} up to date, ${s.missing} without video, ${s.failed} failed`,
    )
    return s
  })

export const gifsCommand = Command.make(
  "gifs",
  {
    force: forceFlag,
    songs: idListFlag("songs", "Only these song ids"),
    concurrency: concurrencyFlag(Math.max(2, Math.min(6, defaultWorkerCount())), "ffmpeg renders in parallel"),
    skipClips: Flag.Boolean("skip-clips").pipe(
      Flag.withDescription("Do not render the impact stories' featured clips"),
      Flag.withDefault(false),
    ),
  },
  ({ force, songs, concurrency, skipClips }) => gifs({ force, concurrency, skipClips, ...(songs ? { songs } : {}) }),
).pipe(Command.withDescription("Chorus GIF per music video (media/gifs) + impact featured clips (media/clips)"))
