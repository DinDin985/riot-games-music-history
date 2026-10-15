import { quantile } from "./signal.ts"

/**
 * Chorus finder: the most-repeated loud 8–16 s section of a track.
 *
 * 1. **Features.** HPCP chroma (harmony) and MFCC (timbre) frames are pooled to
 *    ~0.28 s, smoothed, mean-centred over the audible frames and L2-normalised;
 *    frame power gives a loudness rank (0 = quietest, 1 = loudest audible frame).
 *    Timbre matters for songs that loop one chord progression throughout.
 * 2. **Self-similarity.** Blended cosine similarity between every pair of frames,
 *    accumulated along diagonals so that "section [s, s+L) sounds like
 *    [t, t+L)" — the mean similarity along one diagonal — is O(1).
 * 3. **Thumbnail search.** For every candidate section (start s, length
 *    L ∈ 8…16 s) the repeats are the non-overlapping local maxima of that
 *    diagonal mean over t, z-scored against all section pairs of that length.
 *    A repeat must also *hold*: most frames along its diagonal (≥ 70 %) must be
 *    similar on their own, so one shared chord plus noise is not a repeat.
 *    fitness = Σ repeat z; score = fitness × loudness² × a mild length bonus.
 *    A chorus is the section that comes back most often and most faithfully,
 *    and it is loud — verses repeat too, but quieter and less exactly.
 * 4. **Occurrence.** Of the winning section's occurrences, take the first one
 *    past the intro (≥ 10 % of the track) that is about as loud as the loudest
 *    occurrence — typically the first full chorus.
 * 5. **Boundaries.** Snap the start to a nearby structural boundary (Foote
 *    novelty peak on the self-similarity matrix where loudness rises), then to
 *    the nearest beat.
 *
 * Returns `null` when nothing repeats convincingly (ambient score, through-
 * composed cinematics, very short or very long tracks).
 */

export interface ChorusInput {
  /** Raw HPCP rows (12 values each); frame `i` is centred at `i * hopSeconds`. */
  readonly chroma: ReadonlyArray<Float32Array>
  /** Optional timbre frames (e.g. MFCC c1…c12), same framing; blended into the self-similarity. */
  readonly timbre?: ReadonlyArray<Float32Array>
  /** Mean power of each chroma frame (same framing). */
  readonly power: Float32Array
  readonly hopSeconds: number
  readonly duration: number
  /** Beat positions in seconds (RhythmExtractor2013 ticks), used to snap the start. */
  readonly beats?: ReadonlyArray<number>
}

export interface Chorus {
  readonly start: number
  readonly end: number
  readonly confidence: number
}

export interface ChorusOptions {
  readonly minSeconds?: number
  readonly maxSeconds?: number
  readonly stepSeconds?: number
  /** Pooled frame size in seconds. */
  readonly targetHop?: number
  /** Share of the timbre similarity in the blended self-similarity (0–1). */
  readonly timbreWeight?: number
  /** Moving-average length applied to the pooled features, seconds. */
  readonly smoothSeconds?: number
  /** z-score (vs. all section pairs) a repeat must reach. */
  readonly minRepeatZ?: number
  /** Mean cosine similarity a repeat must reach in absolute terms. */
  readonly minRepeatSimilarity?: number
  /** Per-frame similarity that counts as "this frame repeats". */
  readonly holdSimilarity?: number
  /** Share of the frames along a repeat's diagonal that must reach `holdSimilarity`. */
  readonly minHold?: number
  /** Tracks longer than this are not searched (medleys, extended mixes). */
  readonly maxTrackSeconds?: number
}

export interface ChorusDebug {
  readonly chorus: Chorus | null
  readonly hop: number
  readonly occurrences: ReadonlyArray<{ readonly start: number; readonly end: number; readonly z: number; readonly loudness: number }>
  readonly lengthSeconds: number
  readonly background: { readonly mean: number; readonly std: number }
  readonly ssm: Float32Array
  readonly frames: number
}

interface Candidate {
  readonly s: number
  readonly L: number
  readonly repeats: ReadonlyArray<{ readonly t: number; readonly z: number; readonly sim: number }>
  readonly fitness: number
  readonly loudness: number
  readonly score: number
  readonly background: { readonly mean: number; readonly std: number }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export const findChorus = (input: ChorusInput, options: ChorusOptions = {}): Chorus | null =>
  findChorusDebug(input, options)?.chorus ?? null

export const findChorusDebug = (input: ChorusInput, options: ChorusOptions = {}): ChorusDebug | null => {
  const minSeconds = options.minSeconds ?? 8
  const maxSeconds = options.maxSeconds ?? 16
  const stepSeconds = options.stepSeconds ?? 2
  const minRepeatZ = options.minRepeatZ ?? 2
  const minRepeatSimilarity = options.minRepeatSimilarity ?? 0.35
  const holdSimilarity = options.holdSimilarity ?? 0.5
  const minHold = options.minHold ?? 0.7
  if (input.duration > (options.maxTrackSeconds ?? 900)) return null

  // --- 1. pooled features
  const pool = Math.max(1, Math.round((options.targetHop ?? 0.28) / input.hopSeconds))
  const hop = pool * input.hopSeconds
  const N = Math.floor(input.chroma.length / pool)
  const minL = Math.round(minSeconds / hop)
  if (N < minL * 2 + 2) return null

  const db = new Float32Array(N)
  for (let n = 0; n < N; n++) {
    let power = 0
    for (let k = 0; k < pool; k++) power += (input.power[n * pool + k] ?? 0) / pool
    db[n] = 10 * Math.log10(power + 1e-12)
  }
  const loudDb = quantile(db, 0.98)
  const active = Array.from(db, (v) => v > loudDb - 40)
  const activeDb = Float32Array.from(db.filter((_, n) => active[n]))
  if (activeDb.length < minL * 2) return null
  const sortedDb = Float64Array.from(activeDb).sort()
  /** Loudness rank 0–1 among audible frames. */
  const rank = Float32Array.from(db, (v, n) => {
    if (!active[n]) return 0
    let lo = 0
    let hi = sortedDb.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sortedDb[mid]! < v) lo = mid + 1
      else hi = mid
    }
    return lo / Math.max(1, sortedDb.length - 1)
  })
  const rankPrefix = new Float64Array(N + 1)
  for (let n = 0; n < N; n++) rankPrefix[n + 1] = rankPrefix[n]! + rank[n]!
  const meanRank = (s: number, L: number) => (rankPrefix[Math.min(N, s + L)]! - rankPrefix[s]!) / L

  const smoothRadius = Math.max(0, Math.round((options.smoothSeconds ?? 1.5) / hop / 2))
  const chroma = conditionFrames(input.chroma, N, pool, active, smoothRadius, "chroma")
  const timbre = input.timbre && input.timbre.length >= N * pool
    ? conditionFrames(input.timbre, N, pool, active, smoothRadius, "timbre")
    : null
  const timbreWeight = timbre ? (options.timbreWeight ?? 0.4) : 0

  // --- 2. self-similarity (chroma ⊕ timbre) + diagonal prefix sums
  const S = new Float32Array(N * N)
  const cosine = (m: { data: Float32Array; dims: number }, i: number, j: number) => {
    let dot = 0
    for (let c = 0; c < m.dims; c++) dot += m.data[i * m.dims + c]! * m.data[j * m.dims + c]!
    return dot
  }
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let sim = cosine(chroma, i, j)
      if (timbre) sim = (1 - timbreWeight) * sim + timbreWeight * cosine(timbre, i, j)
      S[i * N + j] = sim
      S[j * N + i] = sim
    }
  }
  // P: diagonal prefix sums of S; H: diagonal prefix counts of frames similar enough to "hold" a repeat
  const P = new Float32Array(N * N)
  const H = N < 65535 ? new Uint16Array(N * N) : new Uint32Array(N * N)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const diagonal = i > 0 && j > 0
      P[i * N + j] = S[i * N + j]! + (diagonal ? P[(i - 1) * N + (j - 1)]! : 0)
      H[i * N + j] = (S[i * N + j]! >= holdSimilarity ? 1 : 0) + (diagonal ? H[(i - 1) * N + (j - 1)]! : 0)
    }
  }
  const diagMean = (s: number, t: number, L: number) => {
    const end = P[(s + L - 1) * N + (t + L - 1)]!
    const before = s > 0 && t > 0 ? P[(s - 1) * N + (t - 1)]! : 0
    return (end - before) / L
  }
  /** Share of frames along the diagonal [s, s+L) × [t, t+L) that are individually similar. */
  const diagHold = (s: number, t: number, L: number) => {
    const end = H[(s + L - 1) * N + (t + L - 1)]!
    const before = s > 0 && t > 0 ? H[(s - 1) * N + (t - 1)]! : 0
    return (end - before) / L
  }

  // --- 3. thumbnail search
  const lengths: number[] = []
  for (let sec = minSeconds; sec <= maxSeconds + 1e-9; sec += stepSeconds) {
    const L = Math.round(sec / hop)
    if (L * 2 <= N && !lengths.includes(L)) lengths.push(L)
  }
  let best: Candidate | null = null
  for (const L of lengths) {
    const last = N - L
    // background: every pair of non-overlapping sections of this length
    let sum = 0
    let sumSq = 0
    let count = 0
    for (let s = 0; s <= last; s++) {
      for (let t = s + L; t <= last; t++) {
        const d = diagMean(s, t, L)
        sum += d
        sumSq += d * d
        count++
      }
    }
    if (count < 10) continue
    const bgMean = sum / count
    const bgStd = Math.sqrt(Math.max(1e-9, sumSq / count - bgMean * bgMean))
    const minLag = Math.max(1, Math.round(L * 0.75))
    const values = new Float32Array(last + 1)

    for (let s = 0; s <= last; s++) {
      if (!active[s]) continue
      for (let t = 0; t <= last; t++) values[t] = Math.abs(t - s) >= minLag ? diagMean(s, t, L) : Number.NEGATIVE_INFINITY
      // local maxima above both thresholds, greedily non-overlapping
      const peaks: Array<{ t: number; sim: number }> = []
      for (let t = 0; t <= last; t++) {
        const v = values[t]!
        if (v < minRepeatSimilarity || (v - bgMean) / bgStd < minRepeatZ) continue
        if ((t > 0 && values[t - 1]! > v) || (t < last && values[t + 1]! >= v)) continue
        if (diagHold(s, t, L) < minHold) continue
        peaks.push({ t, sim: v })
      }
      if (peaks.length === 0) continue
      peaks.sort((a, b) => b.sim - a.sim)
      const repeats: Array<{ t: number; z: number; sim: number }> = []
      for (const p of peaks) {
        if (repeats.length >= 6) break
        if (repeats.some((r) => Math.abs(r.t - p.t) < minLag)) continue
        repeats.push({ t: p.t, sim: p.sim, z: (p.sim - bgMean) / bgStd })
      }
      let fitness = 0
      for (const r of repeats) fitness += Math.min(r.z, 8)
      let loudness = meanRank(s, L)
      for (const r of repeats) loudness += meanRank(r.t, L)
      loudness /= repeats.length + 1
      const score = fitness * (0.2 + loudness) ** 2 * (L / minL) ** 0.25
      if (!best || score > best.score) {
        best = { s, L, repeats, fitness, loudness, score, background: { mean: bgMean, std: bgStd } }
      }
    }
  }
  if (!best) {
    return { chorus: null, hop, occurrences: [], lengthSeconds: 0, background: { mean: 0, std: 0 }, ssm: S, frames: N }
  }

  // --- 4. pick the occurrence
  const L = best.L
  const occurrences = [{ t: best.s, z: Number.POSITIVE_INFINITY }, ...best.repeats.map((r) => ({ t: r.t, z: r.z }))]
    .map((o) => ({ ...o, loudness: meanRank(o.t, L) }))
    .sort((a, b) => a.t - b.t)
  const loudest = Math.max(...occurrences.map((o) => o.loudness))
  const minStart = (input.duration * 0.1) / hop
  const chosen =
    occurrences.find((o) => o.t >= minStart && o.loudness >= loudest - 0.12) ??
    occurrences.reduce((a, b) => (b.loudness > a.loudness ? b : a))

  // --- 5. boundaries: novelty peak where loudness rises, then nearest beat
  const novelty = footeNovelty(S, N, Math.max(2, Math.round(3 / hop)))
  const radius = Math.round(2.5 / hop)
  const novMean = novelty.reduce((a, b) => a + b, 0) / N
  const novStd = Math.sqrt(novelty.reduce((a, b) => a + (b - novMean) ** 2, 0) / N) || 1
  const lift = Math.round(2 / hop)
  let startFrame = chosen.t
  let bestBoundary = Number.NEGATIVE_INFINITY
  for (let n = Math.max(1, chosen.t - radius); n <= Math.min(N - L, chosen.t + radius); n++) {
    const isPeak = novelty[n]! >= novelty[n - 1]! && novelty[n]! >= (novelty[n + 1] ?? 0)
    const z = (novelty[n]! - novMean) / novStd
    if (!isPeak || z < 1) continue
    const rise = meanRank(n, lift) - meanRank(Math.max(0, n - lift), Math.min(lift, n))
    // prefer strong boundaries close to the diagonal estimate where it gets louder
    const value = z + 4 * rise - (Math.abs(n - chosen.t) / radius) * 1.5
    if (value > bestBoundary) {
      bestBoundary = value
      startFrame = n
    }
  }
  let start = startFrame * hop
  const beats = input.beats ?? []
  if (beats.length > 0) {
    let nearest = beats[0]!
    for (const b of beats) if (Math.abs(b - start) < Math.abs(nearest - start)) nearest = b
    if (Math.abs(nearest - start) <= 0.4) start = nearest
  }
  const lengthSeconds = L * hop
  const end = Math.min(input.duration, start + lengthSeconds)

  // Confidence: how faithfully the section comes back (absolute similarity — a z-score alone stays low
  // in songs built from few chords, where every section resembles every other), how much it stands out
  // (z), how often it comes back (a chorus heard three times = two repeats) and how loud it is.
  const meanZ = best.repeats.reduce((a, r) => a + r.z, 0) / best.repeats.length
  const meanSim = best.repeats.reduce((a, r) => a + r.sim, 0) / best.repeats.length
  const confidence = clamp01(
    0.35 * clamp01((meanSim - minRepeatSimilarity) / 0.5) +
      0.25 * clamp01((meanZ - minRepeatZ) / 3) +
      0.2 * Math.min(1, best.repeats.length / 2) +
      0.2 * best.loudness,
  )
  const round = (x: number) => Math.round(x * 1000) / 1000
  return {
    chorus: { start: round(start), end: round(end), confidence: Math.round(confidence * 100) / 100 },
    hop,
    occurrences: occurrences.map((o) => ({
      start: round(o.t * hop),
      end: round((o.t + L) * hop),
      z: Number.isFinite(o.z) ? Math.round(o.z * 100) / 100 : 99,
      loudness: Math.round(o.loudness * 100) / 100,
    })),
    lengthSeconds: round(lengthSeconds),
    background: best.background,
    ssm: S,
    frames: N,
  }
}

/**
 * Foote novelty: correlate a Gaussian-tapered checkerboard kernel along the
 * main diagonal of the self-similarity matrix. Peaks = section boundaries.
 */
export const footeNovelty = (S: Float32Array, N: number, halfWidth: number): Float32Array => {
  const K = halfWidth
  const kernel = new Float32Array(4 * K * K)
  const sigma = K / 2
  for (let a = -K; a < K; a++) {
    for (let b = -K; b < K; b++) {
      const sign = (a < 0) === (b < 0) ? 1 : -1
      const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * sigma * sigma))
      kernel[(a + K) * 2 * K + (b + K)] = sign * g
    }
  }
  const out = new Float32Array(N)
  for (let n = 0; n < N; n++) {
    let acc = 0
    for (let a = -K; a < K; a++) {
      const i = n + a
      if (i < 0 || i >= N) continue
      for (let b = -K; b < K; b++) {
        const j = n + b
        if (j < 0 || j >= N) continue
        acc += kernel[(a + K) * 2 * K + (b + K)]! * S[i * N + j]!
      }
    }
    out[n] = acc
  }
  return out
}

/**
 * Pool `pool` consecutive frames, then condition them for cosine similarity:
 * - chroma: log-compress (CENS-like), so faint notes still count;
 * - timbre (MFCC): standardise each coefficient over the audible frames.
 * Both are smoothed over ~1.5 s (harmonic progressions, not single notes),
 * mean-centred over audible frames and L2-normalised; silent frames → zero.
 */
const conditionFrames = (
  frames: ReadonlyArray<Float32Array>,
  N: number,
  pool: number,
  active: ReadonlyArray<boolean>,
  smoothRadius: number,
  kind: "chroma" | "timbre",
): { data: Float32Array; dims: number } => {
  const dims = frames[0]?.length ?? 0
  const pooled = new Float32Array(N * dims)
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < pool; k++) {
      const frame = frames[n * pool + k]!
      for (let c = 0; c < dims; c++) {
        const v = frame[c] ?? 0
        pooled[n * dims + c]! += (kind === "chroma" ? Math.log1p(10 * v) : v) / pool
      }
    }
  }
  const data = new Float32Array(N * dims)
  for (let n = 0; n < N; n++) {
    const lo = Math.max(0, n - smoothRadius)
    const hi = Math.min(N - 1, n + smoothRadius)
    for (let c = 0; c < dims; c++) {
      let acc = 0
      for (let m = lo; m <= hi; m++) acc += pooled[m * dims + c]!
      data[n * dims + c] = acc / (hi - lo + 1)
    }
  }
  const mean = new Float64Array(dims)
  const sq = new Float64Array(dims)
  let count = 0
  for (let n = 0; n < N; n++) {
    if (!active[n]) continue
    count++
    for (let c = 0; c < dims; c++) {
      mean[c]! += data[n * dims + c]!
      sq[c]! += data[n * dims + c]! ** 2
    }
  }
  for (let c = 0; c < dims; c++) {
    mean[c]! /= Math.max(1, count)
    sq[c] = kind === "timbre" ? Math.sqrt(Math.max(1e-12, sq[c]! / Math.max(1, count) - mean[c]! ** 2)) : 1
  }
  for (let n = 0; n < N; n++) {
    let norm = 0
    for (let c = 0; c < dims; c++) {
      const v = active[n] ? (data[n * dims + c]! - mean[c]!) / sq[c]! : 0
      data[n * dims + c] = v
      norm += v * v
    }
    norm = Math.sqrt(norm)
    for (let c = 0; c < dims; c++) data[n * dims + c] = norm > 1e-6 ? data[n * dims + c]! / norm : 0
  }
  return { data, dims }
}
