"use client"

import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The archive's signature visual: thin, rounded vertical bars mirrored around
 * a horizontal centre line (white on the deep navy #0c1d2e in the dark theme).
 * The middle bars are the tallest and brightest; bars get progressively
 * shorter and fainter towards both sides.
 *
 * Bar height = level × centre-weight envelope, where the level comes from
 *  - a live `AnalyserNode` while the song plays (`getAnalyser` /
 *    `getFrequencyData`) — low frequencies in the middle, highs at the sides;
 *  - otherwise the precomputed loudness envelope (`peaks`) in a window around
 *    the current time, so the shape scrolls with the song (the centre bar is
 *    "now", bars to the right are the next few seconds);
 *  - otherwise a deterministic shape derived from `seed`.
 * Beats (`beats`) add a short pulse, levels are eased per bar, and a paused
 * waveform "breathes" gently (`idle`).
 *
 * Bars are deliberately *not* smooth neighbours (`texture`): in peaks mode each
 * bar takes the loudest moment of its own time slice and a jitter anchored to
 * song time (so the pattern scrolls with the music); in live mode each bar
 * reads a scattered frequency band and the jitter re-rolls on every beat.
 *
 * Rendering: one <canvas>, device-pixel-ratio aware, resized with a
 * ResizeObserver; the requestAnimationFrame loop only runs while the canvas is
 * on screen and the tab is visible. Time is *pulled* each frame through
 * `getTime`, so the parent never needs to re-render at 60 fps.
 *
 * ```tsx
 * const player = usePlayer()
 * <Waveform
 *   variant="hero"
 *   peaks={analysis?.peaks}
 *   peaksRate={analysis?.peaksRate}
 *   beats={analysis?.beats}
 *   getTime={player.getCurrentTime}
 *   playing={player.isPlaying}
 *   getAnalyser={() => player.analyser}
 *   onSeek={player.seek}
 *   className="h-48 w-full"
 * />
 * ```
 */
export type WaveformVariant = "hero" | "card" | "player"

export interface WaveformProps extends Omit<React.ComponentProps<"div">, "children" | "onChange"> {
  /** Preset for bar size, spacing, window length and centre weighting (default "player"). */
  readonly variant?: WaveformVariant
  /** Loudness envelope (SongAnalysis.peaks): base64 string or decoded bytes (0–255). */
  readonly peaks?: string | Uint8Array | ReadonlyArray<number> | null
  /** Samples per second of `peaks` (SongAnalysis.peaksRate). */
  readonly peaksRate?: number | null
  /** Beat times in seconds (SongAnalysis.beats) — each one pulses the middle bars. */
  readonly beats?: ReadonlyArray<number> | null
  /** Current song time in seconds, polled every animation frame. */
  readonly getTime?: () => number
  /** Static time used when `getTime` is not given (default 0). */
  readonly time?: number
  /** Song length; clamps seeking and the peaks window. */
  readonly duration?: number | null
  /** Whether the song is playing. Paused → idle breathing; playing → live levels. */
  readonly playing?: boolean
  /** Live analyser (used only while `playing`). Read every frame, so it may appear later. */
  readonly getAnalyser?: () => AnalyserNode | null | undefined
  /** Alternative to `getAnalyser`: fill `out` with byte frequency data, return false when unavailable. */
  readonly getFrequencyData?: (out: Uint8Array<ArrayBuffer>) => boolean
  /** Seed for the fallback shape when there are no peaks (e.g. song id). */
  readonly seed?: string
  /** Bar colour. Default: the `--waveform` theme colour (white on navy). */
  readonly color?: string
  /** Bar width in CSS px. */
  readonly barWidth?: number
  /** Gap between bars in CSS px. */
  readonly gap?: number
  /** Seconds of song visible across the whole width in peaks mode. */
  readonly windowSeconds?: number
  /** 0–1: how strongly the middle dominates (higher = narrower, taller centre). */
  readonly centerWeight?: number
  /** Opacity of the outermost bars (0–1). */
  readonly minOpacity?: number
  /** 0–1: bar-to-bar variation (0 = smooth envelope, 1 = very jagged). */
  readonly texture?: number
  /** Breathe while paused (default true). */
  readonly idle?: boolean
  /** Draw a faint centre line. */
  readonly showAxis?: boolean
  /** Dim the bars after the centre (the part of the window that has not played yet). */
  readonly dimFuture?: boolean
  /** Click / drag on the waveform to seek (window mode: centre = now). Also enables arrow keys. */
  readonly onSeek?: (time: number) => void
}

interface Preset {
  readonly barWidth: number
  readonly gap: number
  readonly windowSeconds: number
  readonly centerWeight: number
  readonly minOpacity: number
  /** Fraction of the height the tallest bar may use. */
  readonly fill: number
  /** Smallest bar (a dot), in CSS px. */
  readonly minBar: number
  /** Bar-to-bar variation, see `texture`. */
  readonly texture: number
}

const PRESETS: Record<WaveformVariant, Preset> = {
  hero: { barWidth: 3, gap: 9, windowSeconds: 14, centerWeight: 0.55, minOpacity: 0.18, fill: 0.96, minBar: 4, texture: 0.62 },
  card: { barWidth: 2, gap: 5, windowSeconds: 7, centerWeight: 0.5, minOpacity: 0.25, fill: 0.92, minBar: 2, texture: 0.55 },
  player: { barWidth: 2, gap: 5, windowSeconds: 9, centerWeight: 0.45, minOpacity: 0.3, fill: 0.95, minBar: 2, texture: 0.5 },
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests / other renderers)

/** Decode `peaks` into bytes. */
export function toPeakBytes(peaks: WaveformProps["peaks"]): Uint8Array | null {
  if (!peaks) return null
  if (peaks instanceof Uint8Array) return peaks
  if (typeof peaks === "string") {
    if (peaks.length === 0) return null
    try {
      const binary = atob(peaks)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  return Uint8Array.from(peaks)
}

/**
 * Centre-weight envelope for a bar at `u` ∈ [-1, 1] (0 = middle): a Gaussian
 * bump on a small floor, so the middle is tallest and the sides taper off.
 */
export function centerEnvelope(u: number, centerWeight: number): number {
  const cw = Math.min(1, Math.max(0, centerWeight))
  const sigma = 0.74 - 0.36 * cw
  const floor = 0.34 - 0.2 * cw
  return floor + (1 - floor) * Math.exp(-(u * u) / (2 * sigma * sigma))
}

/** Deterministic pseudo-random in [0, 1). */
function hashNoise(seed: number, i: number): number {
  let h = Math.imul(seed ^ (i * 374761393), 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Multiplier for bar-to-bar variation, in [1 − texture, 1.15]: most bars sit
 * well below the top with frequent deep cuts and a few spikes above it (the
 * spikes only show where there is headroom), like a hand-drawn waveform.
 */
export function jitter(seed: number, key: number, texture: number): number {
  if (texture <= 0) return 1
  const r = hashNoise(seed ^ 0x2545f491, key)
  if (r > 0.86) return 1 + 0.15 * texture * ((r - 0.86) / 0.14)
  return 1 - texture * Math.pow(1 - r / 0.86, 0.8)
}

/** Index of the last beat ≤ t (binary search), or -1. */
function lastBeatIndex(beats: ReadonlyArray<number>, t: number): number {
  let lo = 0
  let hi = beats.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** 98th-percentile level, used to normalise quiet masters. */
function peakReference(bytes: Uint8Array): number {
  if (bytes.length === 0) return 255
  const hist = new Uint32Array(256)
  for (let i = 0; i < bytes.length; i++) hist[bytes[i]!]!++
  const target = bytes.length * 0.98
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!
    if (acc >= target) return Math.max(48, v)
  }
  return 255
}

// ---------------------------------------------------------------------------

export function Waveform({
  variant = "player",
  peaks,
  peaksRate,
  beats,
  getTime,
  time,
  duration,
  playing = false,
  getAnalyser,
  getFrequencyData,
  seed,
  color,
  barWidth,
  gap,
  windowSeconds,
  centerWeight,
  minOpacity,
  texture,
  idle = true,
  showAxis = false,
  dimFuture = false,
  onSeek,
  className,
  "aria-label": ariaLabel,
  ...props
}: WaveformProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const preset = PRESETS[variant]

  const peakBytes = React.useMemo(() => toPeakBytes(peaks), [peaks])
  const peakRef = React.useMemo(() => (peakBytes ? peakReference(peakBytes) : 255), [peakBytes])
  const seedHash = React.useMemo(() => hashString(seed ?? "riot"), [seed])

  // Everything the animation loop reads lives in a ref so the loop never restarts on re-render.
  const live = {
    preset,
    peakBytes,
    peakRef,
    peaksRate: peaksRate ?? 0,
    beats: beats ?? [],
    getTime,
    time: time ?? 0,
    duration: duration ?? null,
    playing,
    getAnalyser,
    getFrequencyData,
    seedHash,
    color,
    barWidth: barWidth ?? preset.barWidth,
    gap: gap ?? preset.gap,
    windowSeconds: windowSeconds ?? preset.windowSeconds,
    centerWeight: centerWeight ?? preset.centerWeight,
    minOpacity: minOpacity ?? preset.minOpacity,
    texture: Math.min(1, Math.max(0, texture ?? preset.texture)),
    idle,
    showAxis,
    dimFuture,
  }
  const liveRef = React.useRef(live)
  liveRef.current = live

  React.useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let cssWidth = 0
    let cssHeight = 0
    let dpr = 1
    let heights = new Float32Array(0)
    let targets = new Float32Array(0)
    let freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
    let resolvedColor = "#ffffff"
    let frame = 0
    let raf = 0
    let last = performance.now()
    let visible = true
    let pageVisible = typeof document === "undefined" ? true : !document.hidden
    // Reduced motion: no idle breathing (live levels still follow the music).
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

    const resolveColor = () => {
      const c = liveRef.current.color
      if (c) {
        resolvedColor = c
        return
      }
      const v = getComputedStyle(container).getPropertyValue("--waveform").trim()
      resolvedColor = v || "#ffffff"
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      cssWidth = Math.max(0, rect.width)
      cssHeight = Math.max(0, rect.height)
      dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(cssWidth * dpr))
      canvas.height = Math.max(1, Math.round(cssHeight * dpr))
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      resolveColor()
      draw(0)
    }

    const barCount = () => {
      const { barWidth: bw, gap: g } = liveRef.current
      return Math.max(1, Math.floor((cssWidth + g) / (bw + g)))
    }

    /** Fill `targets` (0–1 per bar, before the centre envelope) and return the beat pulse. */
    const computeTargets = (n: number, now: number, t: number): number => {
      const p = liveRef.current
      const half = (n - 1) / 2 || 1

      // 1. Live spectrum.
      let liveOk = false
      if (p.playing) {
        const analyser = p.getAnalyser?.()
        if (analyser) {
          if (freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
          analyser.getByteFrequencyData(freq)
          liveOk = true
          const nyquist = analyser.context.sampleRate / 2
          fillFromSpectrum(n, half, nyquist)
        } else if (p.getFrequencyData) {
          if (freq.length === 0) freq = new Uint8Array(new ArrayBuffer(1024))
          if (p.getFrequencyData(freq)) {
            liveOk = true
            fillFromSpectrum(n, half, 22050)
          }
        }
        // A silent analyser (e.g. a stalled stream or the first frames) falls back to peaks.
        if (liveOk) {
          let sum = 0
          for (let i = 0; i < freq.length; i++) sum += freq[i]!
          if (sum === 0) liveOk = false
        }
      }

      // 2. Precomputed envelope in a window around `t`.
      if (!liveOk) {
        const bytes = p.peakBytes
        if (bytes && p.peaksRate > 0) {
          const span = p.windowSeconds / 2
          const perBar = p.windowSeconds / n
          const halfSlice = Math.max(1, (perBar * p.peaksRate) / 2)
          for (let i = 0; i < n; i++) {
            const u = (i - half) / half
            const ti = t + u * span
            const x = ti * p.peaksRate
            // Loudest moment of this bar's slice (a point sample of a smooth envelope looks flat).
            let v = 0
            const a = Math.max(0, Math.floor(x - halfSlice))
            const b = Math.min(bytes.length - 1, Math.ceil(x + halfSlice))
            for (let k = a; k <= b; k++) v = Math.max(v, bytes[k]!)
            // Jitter anchored to song time, so the pattern scrolls with the music instead of flickering.
            const bucket = Math.floor(ti / perBar)
            targets[i] = Math.min(1, 0.86 * Math.pow(v / p.peakRef, 1.35) * jitter(p.seedHash, bucket, p.texture))
          }
        } else {
          // 3. Deterministic shape from the seed, slowly drifting.
          for (let i = 0; i < n; i++) {
            const a = hashNoise(p.seedHash, i)
            const b = hashNoise(p.seedHash, i + 9973)
            targets[i] = (0.35 + 0.6 * a * (0.75 + 0.25 * Math.sin(now / 900 + b * 6.283))) * jitter(p.seedHash, i + 7919, p.texture * 0.6)
          }
        }
      }

      // Idle breathing: a slow wave travelling across the bars.
      if (!p.playing && p.idle && !reducedMotion) {
        for (let i = 0; i < n; i++) {
          const u = (i - half) / half
          const breath = 0.72 + 0.16 * Math.sin(now / 820 + u * 2.4) + 0.06 * Math.sin(now / 1900 - u * 5)
          targets[i] = Math.max(0.12, targets[i]!) * breath
        }
      } else if (!p.playing) {
        for (let i = 0; i < n; i++) targets[i] = targets[i]! * 0.7
      }

      // Beat pulse (exponential decay after each beat).
      if (p.playing && p.beats.length > 0) {
        const bi = lastBeatIndex(p.beats, t)
        if (bi >= 0) {
          const dt = t - p.beats[bi]!
          if (dt >= 0 && dt < 0.6) return Math.exp(-dt / 0.11)
        }
      }
      return 0
    }

    /**
     * Map spectrum bins onto bars: lows in the middle, highs at the edges. Each bar
     * reads a band scattered up to ±0.6 octave from its slot, so neighbours differ.
     */
    const fillFromSpectrum = (n: number, half: number, nyquist: number) => {
      const bins = freq.length
      const minF = 45
      const maxF = 11000
      const p = liveRef.current
      const beatSalt = p.beats.length > 0 ? lastBeatIndex(p.beats, p.getTime ? p.getTime() : p.time) * 131 : 0
      for (let i = 0; i < n; i++) {
        const u = (i - half) / half
        const d = Math.abs(u)
        const scatter = Math.pow(2, (hashNoise(p.seedHash ^ 0x51ed27, i) - 0.5) * 1.2 * p.texture)
        // Detune the right half so the two sides are not perfect mirror images.
        const fCentre = minF * Math.pow(maxF / minF, d) * (u > 0 ? 1.07 : 1) * scatter
        const fWidth = Math.max(1, fCentre * 0.12)
        const b0 = Math.max(0, Math.floor(((fCentre - fWidth) / nyquist) * bins))
        const b1 = Math.min(bins - 1, Math.max(b0, Math.ceil(((fCentre + fWidth) / nyquist) * bins)))
        let max = 0
        for (let b = b0; b <= b1; b++) max = Math.max(max, freq[b]!)
        // Gentle high-frequency tilt so treble does not look dead next to the bass.
        const tilt = 1 + d * 0.35
        targets[i] = Math.min(1, 0.9 * Math.pow((max / 255) * tilt, 1.45) * jitter(p.seedHash, i * 7 + beatSalt, p.texture * 0.8))
      }
    }

    const draw = (dt: number) => {
      const p = liveRef.current
      const n = barCount()
      if (heights.length !== n) {
        const prev = heights
        heights = new Float32Array(n)
        targets = new Float32Array(n)
        // Keep the old shape roughly when the bar count changes (resize).
        for (let i = 0; i < n; i++) heights[i] = prev.length ? prev[Math.floor((i / n) * prev.length)]! : 0
      }
      const now = performance.now()
      const t = p.getTime ? p.getTime() : p.time
      const pulse = computeTargets(n, now, Number.isFinite(t) ? t : 0)

      // Ease towards targets: fast attack, slower release.
      if (dt > 0) {
        const kUp = 1 - Math.exp(-dt / 0.045)
        const kDown = 1 - Math.exp(-dt / 0.17)
        for (let i = 0; i < n; i++) {
          const target = targets[i]!
          const h = heights[i]!
          heights[i] = h + (target - h) * (target > h ? kUp : kDown)
        }
      } else {
        heights.set(targets)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      if (cssWidth === 0 || cssHeight === 0) return

      const { barWidth: bw, gap: g, centerWeight: cw, minOpacity: minA } = p
      const half = (n - 1) / 2 || 1
      const totalWidth = n * bw + (n - 1) * g
      const x0 = (cssWidth - totalWidth) / 2 + bw / 2
      const cy = cssHeight / 2
      const maxH = cssHeight * p.preset.fill
      const minH = Math.min(p.preset.minBar, maxH)

      ctx.strokeStyle = resolvedColor
      ctx.fillStyle = resolvedColor
      ctx.lineCap = "round"
      ctx.lineWidth = bw

      if (p.showAxis) {
        ctx.globalAlpha = 0.12
        ctx.fillRect(0, Math.round(cy) - 0.5, cssWidth, 1)
      }

      for (let i = 0; i < n; i++) {
        const u = (i - half) / half
        const env = centerEnvelope(u, cw)
        const boost = 1 + 0.22 * pulse * env * env
        const h = Math.max(minH, Math.min(maxH, heights[i]! * env * boost * maxH))
        let alpha = minA + (1 - minA) * Math.pow(env, 0.9)
        if (p.dimFuture && u > 0.02) alpha *= 0.62
        ctx.globalAlpha = Math.min(1, alpha * (0.9 + 0.1 * pulse))
        const x = x0 + i * (bw + g)
        // Round caps add bw/2 at each end: shorten the line so the bar is exactly `h` tall.
        const inner = Math.max(0, h - bw) / 2
        ctx.beginPath()
        ctx.moveTo(x, cy - inner)
        ctx.lineTo(x, cy + inner)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const loop = (ts: number) => {
      const dt = Math.min(0.1, (ts - last) / 1000)
      last = ts
      frame++
      // Pick up theme changes about once a second.
      if (frame % 60 === 0) resolveColor()
      draw(dt)
      raf = visible && pageVisible ? requestAnimationFrame(loop) : 0
    }

    const start = () => {
      if (raf || !visible || !pageVisible) return
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(container)
    resize()

    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const e of entries) visible = e.isIntersecting
            if (visible) start()
            else stop()
          })
    io?.observe(container)

    const onVisibility = () => {
      pageVisible = !document.hidden
      if (pageVisible) start()
      else stop()
    }
    document.addEventListener("visibilitychange", onVisibility)

    start()

    return () => {
      stop()
      ro.disconnect()
      io?.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  // ---- Seeking -----------------------------------------------------------
  const drag = React.useRef<{ x: number; t: number; moved: boolean } | null>(null)
  const currentTime = () => {
    const p = liveRef.current
    return p.getTime ? p.getTime() : p.time
  }
  const clampTime = (t: number) => {
    const d = liveRef.current.duration
    return Math.max(0, d ? Math.min(d - 0.05, t) : t)
  }
  const timeAtX = (clientX: number) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const u = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    return clampTime(currentTime() + (u * liveRef.current.windowSeconds) / 2)
  }

  const seekProps: React.ComponentProps<"div"> = onSeek
    ? {
        role: "slider",
        tabIndex: 0,
        "aria-valuemin": 0,
        "aria-valuemax": duration ?? undefined,
        "aria-valuenow": Math.round(time ?? 0),
        onPointerDown: (e) => {
          if (e.button !== 0) return
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, t: currentTime(), moved: false }
        },
        onPointerMove: (e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (Math.abs(dx) > 3) d.moved = true
          if (!d.moved) return
          // Tape-style scrub: dragging left moves forward in time.
          const width = containerRef.current?.getBoundingClientRect().width ?? 1
          onSeek(clampTime(d.t - (dx / width) * liveRef.current.windowSeconds))
        },
        onPointerUp: (e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved) onSeek(timeAtX(e.clientX))
        },
        onPointerCancel: () => {
          drag.current = null
        },
        onKeyDown: (e) => {
          const step = e.shiftKey ? 15 : 5
          if (e.key === "ArrowRight") onSeek(clampTime(currentTime() + step))
          else if (e.key === "ArrowLeft") onSeek(clampTime(currentTime() - step))
          else return
          e.preventDefault()
        },
      }
    : {}

  return (
    <div
      ref={containerRef}
      data-slot="waveform"
      data-variant={variant}
      role={onSeek ? undefined : "img"}
      aria-label={ariaLabel ?? "Audio waveform"}
      className={cn(
        "relative min-h-4 touch-none select-none",
        onSeek && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-md",
        variant === "hero" && "drop-shadow-[0_0_10px_rgb(255_255_255/0.22)]",
        className,
      )}
      {...seekProps}
      {...props}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block" />
    </div>
  )
}
