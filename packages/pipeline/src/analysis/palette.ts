/**
 * Album-cover helpers on raw interleaved pixel buffers (as produced by
 * `sharp(...).raw().toBuffer({ resolveWithObject: true })`). Pure functions —
 * the covers stage does the I/O.
 */

export interface RawImage {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  /** 3 (RGB) or 4 (RGBA; alpha ignored). */
  readonly channels: number
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Bars {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

const pixel = (img: RawImage, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * img.channels
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}

/** Mean colour and the largest per-channel standard deviation of one row or column. */
const lineStats = (img: RawImage, axis: "column" | "row", index: number) => {
  const length = axis === "column" ? img.height : img.width
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  let n = 0
  for (let k = 0; k < length; k += 2) {
    const [r, g, b] = axis === "column" ? pixel(img, index, k) : pixel(img, k, index)
    sum[0]! += r
    sum[1]! += g
    sum[2]! += b
    sq[0]! += r * r
    sq[1]! += g * g
    sq[2]! += b * b
    n++
  }
  const mean = sum.map((s) => s / n) as [number, number, number]
  const std = Math.max(...sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c]! ** 2))))
  return { mean, std }
}

const distance = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

/**
 * Solid-colour bars along each edge. YouTube art-track thumbnails are the
 * square album art centred on a 16:9 canvas filled with one flat colour (often
 * a dark shade of the art), and 4:3 `hqdefault` thumbnails letterbox 16:9
 * frames with black. A line is a bar while it is flat (low variance, JPEG
 * noise aside) and the same colour as the outermost line.
 */
export const detectBars = (img: RawImage, maxStd = 6, maxColorDistance = 16): Bars => {
  const scan = (axis: "column" | "row", from: number, step: 1 | -1, limit: number) => {
    const edge = lineStats(img, axis, from)
    if (edge.std > maxStd) return 0
    let count = 0
    for (let i = from; count < limit; i += step) {
      const s = lineStats(img, axis, i)
      if (s.std > maxStd || distance(s.mean, edge.mean) > maxColorDistance) break
      count++
    }
    return count
  }
  // never treat more than 45 % of a dimension as bar
  const maxX = Math.floor(img.width * 0.45)
  const maxY = Math.floor(img.height * 0.45)
  const minBar = (size: number) => Math.max(2, Math.round(size * 0.02))
  const keep = (count: number, size: number) => (count >= minBar(size) ? count : 0)
  return {
    left: keep(scan("column", 0, 1, maxX), img.width),
    right: keep(scan("column", img.width - 1, -1, maxX), img.width),
    top: keep(scan("row", 0, 1, maxY), img.height),
    bottom: keep(scan("row", img.height - 1, -1, maxY), img.height),
  }
}

/**
 * The square region to use as the album cover.
 * - Pillarboxed (bars left and right): the art is square and as tall as the
 *   content, centred between the bars. Using the content height instead of the
 *   detected width keeps art whose own edges match the bar colour intact.
 * - Otherwise: the content inside any bars, centre-cropped to a square
 *   (`square: false` when the caller should pick the crop, e.g. by saliency).
 */
export const coverBox = (img: RawImage, bars: Bars = detectBars(img)): { box: Box; square: boolean } => {
  const contentWidth = img.width - bars.left - bars.right
  const contentHeight = img.height - bars.top - bars.bottom
  const centerX = bars.left + contentWidth / 2
  const centerY = bars.top + contentHeight / 2
  if (bars.left > 0 && bars.right > 0) {
    const side = Math.min(contentHeight, img.width)
    const left = Math.round(Math.min(img.width - side, Math.max(0, centerX - side / 2)))
    return { box: { left, top: bars.top, width: side, height: side }, square: true }
  }
  const box = { left: bars.left, top: bars.top, width: contentWidth, height: contentHeight }
  const ratio = contentWidth / contentHeight
  if (ratio > 0.95 && ratio < 1.05) {
    const side = Math.min(contentWidth, contentHeight)
    return {
      box: {
        left: Math.round(centerX - side / 2),
        top: Math.round(centerY - side / 2),
        width: side,
        height: side,
      },
      square: true,
    }
  }
  return { box, square: false }
}

// --- palette ---------------------------------------------------------------

type Lab = [number, number, number]

const srgbToLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}

/** sRGB → CIELAB (D65). Distances in Lab track perceived colour difference. */
export const rgbToLab = (r: number, g: number, b: number): Lab => {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export const labToRgb = ([L, a, b]: Lab): [number, number, number] => {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (108 / 841) * (t - 4 / 29))
  const X = inv(fx) * 0.95047
  const Y = inv(fy)
  const Z = inv(fz) * 1.08883
  return [
    linearToSrgb(3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    linearToSrgb(-0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    linearToSrgb(0.0557 * X - 0.204 * Y + 1.057 * Z),
  ]
}

export const toHex = ([r, g, b]: ReadonlyArray<number>): string =>
  `#${[r!, g!, b!].map((v) => v.toString(16).padStart(2, "0")).join("")}`

export interface PaletteOptions {
  /** Clusters before merging. */
  readonly clusters?: number
  readonly maxColors?: number
  /** Clusters closer than this (ΔE76) are merged. */
  readonly mergeDistance?: number
  /** Lab lightness below which a colour counts as near-black. */
  readonly blackLightness?: number
}

/**
 * Dominant colours, most common first: k-means in CIELAB (deterministic
 * maximin initialisation), near-duplicates merged, tiny clusters and
 * near-black dropped (unless the art is that dark), padded to ≥ 3 colours with
 * lighter/darker shades of the dominant one.
 */
export const extractPalette = (img: RawImage, options: PaletteOptions = {}): string[] => {
  const k = options.clusters ?? 8
  const maxColors = options.maxColors ?? 5
  const mergeDistance = options.mergeDistance ?? 14
  const blackL = options.blackLightness ?? 12

  // sample at most ~6400 pixels on a regular grid
  const stride = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 6400)))
  const points: Lab[] = []
  for (let y = 0; y < img.height; y += stride) {
    for (let x = 0; x < img.width; x += stride) {
      const [r, g, b] = pixel(img, x, y)
      points.push(rgbToLab(r, g, b))
    }
  }
  if (points.length === 0) return []

  const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  // maximin init from the point nearest the mean
  const mean: Lab = [0, 0, 0]
  for (const p of points) for (let c = 0; c < 3; c++) mean[c]! += p[c]! / points.length
  const centroids: Lab[] = [points.reduce((a, b) => (dist2(b, mean) < dist2(a, mean) ? b : a))]
  const nearest = points.map((p) => dist2(p, centroids[0]!))
  while (centroids.length < Math.min(k, points.length)) {
    let far = 0
    for (let i = 1; i < points.length; i++) if (nearest[i]! > nearest[far]!) far = i
    if (nearest[far]! < 1) break
    centroids.push([...points[far]!] as Lab)
    for (let i = 0; i < points.length; i++) nearest[i] = Math.min(nearest[i]!, dist2(points[i]!, centroids.at(-1)!))
  }

  const assignment = new Int32Array(points.length)
  for (let iteration = 0; iteration < 16; iteration++) {
    let moved = 0
    for (let i = 0; i < points.length; i++) {
      let best = 0
      for (let c = 1; c < centroids.length; c++) {
        if (dist2(points[i]!, centroids[c]!) < dist2(points[i]!, centroids[best]!)) best = c
      }
      if (assignment[i] !== best) moved++
      assignment[i] = best
    }
    const sums = centroids.map(() => [0, 0, 0, 0])
    for (let i = 0; i < points.length; i++) {
      const s = sums[assignment[i]!]!
      s[0]! += points[i]![0]
      s[1]! += points[i]![1]
      s[2]! += points[i]![2]
      s[3]!++
    }
    sums.forEach((s, c) => {
      if (s[3]! > 0) centroids[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]
    })
    if (moved === 0 && iteration > 0) break
  }

  let clusters = centroids
    .map((color, c) => ({ color, count: assignment.filter((a) => a === c).length }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count)
  // merge near-duplicates into the larger cluster
  const merged: Array<{ color: Lab; count: number }> = []
  for (const cluster of clusters) {
    const into = merged.find((m) => Math.sqrt(dist2(m.color, cluster.color)) < mergeDistance)
    if (!into) {
      merged.push({ color: [...cluster.color] as Lab, count: cluster.count })
      continue
    }
    const total = into.count + cluster.count
    for (let c = 0; c < 3; c++) into.color[c] = (into.color[c]! * into.count + cluster.color[c]! * cluster.count) / total
    into.count = total
  }
  clusters = merged.sort((a, b) => b.count - a.count)

  const minShare = points.length * 0.02
  const bright = clusters.filter((c) => c.color[0] >= blackL && c.count >= minShare)
  const chosen = (bright.length >= 3 ? bright : [...bright, ...clusters.filter((c) => !bright.includes(c))]).slice(
    0,
    maxColors,
  )
  const colors = chosen.map((c) => c.color)
  const dominant = colors[0] ?? mean
  for (const delta of [22, -18, 40]) {
    if (colors.length >= 3) break
    colors.push([Math.max(0, Math.min(100, dominant[0] + delta)), dominant[1] * 0.85, dominant[2] * 0.85])
  }
  return colors.map((c) => toHex(labToRgb(c)))
}
