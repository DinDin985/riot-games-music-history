import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Animated gradient built from a song's album-cover colours — the stand-in for
 * artwork that is loading or missing, and the stage behind inset covers.
 *
 * Pure CSS (no hooks), so it renders in Server Components, client components
 * and static Astro markup alike. Animations respect `prefers-reduced-motion`.
 *
 * ```tsx
 * <PaletteBackdrop palette={song.palette} className="aspect-square rounded-xl">
 *   <span className="absolute bottom-2 left-2">overlay</span>
 * </PaletteBackdrop>
 * ```
 */
export interface PaletteBackdropProps extends React.ComponentProps<"div"> {
  /** Hex colours, dominant first (SongSummary.palette). Empty → navy/gold default. */
  readonly palette: ReadonlyArray<string>
  /** Drift the colour blobs (default true). */
  readonly animated?: boolean
  /** Varies blob placement so neighbouring cards with similar palettes differ (e.g. song id). */
  readonly seed?: string
  /** Darken towards the bottom so overlaid text stays legible (default true). */
  readonly vignette?: boolean
}

const FALLBACK = ["#173149", "#c89b3c", "#0c1d2e", "#3fa7d6"]

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Normalise to `#rrggbb`, or null when the value is not a hex colour. */
export function normalizeHex(value: string): string | null {
  const m = HEX.exec(value.trim())
  if (!m) return null
  const h = m[1]!
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`.toLowerCase()
}

/** Relative luminance (0–1) of a hex colour. */
export function luminance(hex: string): number {
  const n = normalizeHex(hex)
  if (!n) return 0
  const channel = (i: number) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** Usable palette: valid hex colours, at least four entries (cycled), fallback when empty. */
export function resolvePalette(palette: ReadonlyArray<string>): ReadonlyArray<string> {
  const valid = palette.map(normalizeHex).filter((c): c is string => c !== null)
  const base = valid.length > 0 ? valid : FALLBACK
  return Array.from({ length: Math.max(4, base.length) }, (_, i) => base[i % base.length]!)
}

/** Small deterministic hash → [0, 1). */
function hash01(input: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export function PaletteBackdrop({
  palette,
  animated = true,
  seed,
  vignette = true,
  className,
  style,
  children,
  ...props
}: PaletteBackdropProps) {
  const colors = resolvePalette(palette)
  const key = seed ?? colors.join("")
  // The darkest colour is the base so the blobs read as light sources.
  const base = [...colors].sort((a, b) => luminance(a) - luminance(b))[0]!
  const blobs = colors.slice(0, 4).map((color, i) => ({
    color,
    left: 10 + hash01(key, i * 3 + 1) * 70,
    top: 5 + hash01(key, i * 3 + 2) * 70,
    size: 70 + hash01(key, i * 3 + 3) * 50,
    delay: -hash01(key, i + 17) * 18,
    duration: 14 + i * 4,
  }))

  return (
    <div
      data-slot="palette-backdrop"
      className={cn("relative isolate overflow-hidden", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${base} 70%, #0c1d2e)`, ...style }}
      {...props}
    >
      <div aria-hidden className="absolute inset-[-25%] blur-2xl saturate-125">
        {blobs.map((b, i) => (
          <span
            key={i}
            className={cn("absolute rounded-full opacity-80 mix-blend-screen", animated && "motion-safe:animate-palette-drift")}
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: `${b.size}%`,
              height: `${b.size}%`,
              translate: "-50% -50%",
              background: `radial-gradient(circle at center, ${b.color} 0%, color-mix(in oklab, ${b.color} 40%, transparent) 45%, transparent 70%)`,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
            }}
          />
        ))}
      </div>
      {/* Fine diagonal sheen so flat palettes still feel like artwork. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgb(255 255 255 / 0.06) 0 2px, transparent 2px 9px), radial-gradient(120% 90% at 20% 0%, rgb(255 255 255 / 0.25), transparent 60%)",
        }}
      />
      {vignette && (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-[#0c1d2e]/70 via-transparent to-transparent"
        />
      )}
      {children}
    </div>
  )
}
