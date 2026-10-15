import type { AlignmentSegment } from "@workspace/db/domain/alignment"
import type { AlignmentFeatures } from "./features.ts"

/**
 * Audio-to-audio alignment of a song against its music video.
 *
 * Music videos cut verses, add cold opens and scenes, or splice the final
 * chorus straight after the second one, so a single time offset is not enough.
 *
 * 1. **Similarity.** Cosine similarity between every song chroma frame and every
 *    video chroma frame, accumulated along diagonals (a diagonal = one constant
 *    offset), so any window × offset score is two lookups.
 * 2. **Window z-scores.** The song is cut into overlapping 8 s windows; each
 *    window's score at every offset is z-normalised against all offsets.
 * 3. **Runs.** For every promising offset, consecutive windows whose (smoothed)
 *    z-score clears `nullScore` form a run = a stretch of song the video plays
 *    at that offset.
 * 4. **Chain.** A dynamic program picks runs ordered by song time such that
 *    video time also only moves forward, maximising Σ(z − nullScore) minus a
 *    penalty per cut. Gaps = song material the video left out; jumps in the
 *    other direction = video-only material (intros, skits, dialogue).
 * 5. **Boundaries & fine sync.** Neighbouring segments are split where their
 *    diagonals trade places; each offset is refined to sub-millisecond precision
 *    by waveform cross-correlation (same master) or onset-envelope correlation
 *    (different mix), falling back to the chroma estimate.
 */

export interface AlignOptions {
  readonly windowSeconds?: number
  readonly stepSeconds?: number
  /** Seeds per window considered for runs. */
  readonly seeds?: number
  /** z-score a window must beat to count as "present in the video". */
  readonly nullScore?: number
  /** Minimum z for a window to seed a run. */
  readonly seedScore?: number
  readonly jumpPenalty?: number
  readonly minRunWindows?: number
  readonly minSegmentSeconds?: number
}

export interface AlignResult {
  readonly segments: ReadonlyArray<AlignmentSegment>
  readonly coverage: number
  readonly confidence: number
  readonly refinement: ReadonlyArray<"waveform" | "onset" | "chroma">
}

interface Run {
  readonly offset: number // video frame − song frame
  readonly w0: number
  readonly w1: number
  /** Per-window z for w0..w1. */
  readonly zs: ReadonlyArray<number>
  readonly gain: number
}

const EMPTY: AlignResult = { segments: [], coverage: 0, confidence: 0, refinement: [] }

export const align = (song: AlignmentFeatures, video: AlignmentFeatures, options: AlignOptions = {}): AlignResult => {
  const hop = song.hopSeconds
  const L = Math.max(8, Math.round((options.windowSeconds ?? 8) / hop))
  const step = Math.max(1, Math.round((options.stepSeconds ?? 2) / hop))
  const seeds = options.seeds ?? 8
  const nullScore = options.nullScore ?? 3
  const seedScore = options.seedScore ?? 4
  const jumpPenalty = options.jumpPenalty ?? 4
  const minRunWindows = options.minRunWindows ?? 2
  const ns = song.frames
  const nv = video.frames
  if (ns < L || nv < L) return EMPTY

  // --- 1. diagonal-accumulated similarity: P[i][j] = S[i][j] + P[i-1][j-1]
  const P = new Float32Array(ns * nv)
  for (let i = 0; i < ns; i++) {
    const si = i * 12
    for (let j = 0; j < nv; j++) {
      const vj = j * 12
      let dot = 0
      for (let c = 0; c < 12; c++) dot += song.chroma[si + c]! * video.chroma[vj + c]!
      P[i * nv + j] = dot + (i > 0 && j > 0 ? P[(i - 1) * nv + (j - 1)]! : 0)
    }
  }
  /** Sum of similarity along the diagonal starting at (i0, j0) for `len` frames. */
  const diagSum = (i0: number, j0: number, len: number) => {
    if (len <= 0) return 0
    const end = P[(i0 + len - 1) * nv + (j0 + len - 1)]!
    const before = i0 > 0 && j0 > 0 ? P[(i0 - 1) * nv + (j0 - 1)]! : 0
    return end - before
  }

  // --- 2. windows and their z-scores at every valid offset
  const starts: number[] = []
  for (let a = 0; a + L <= ns; a += step) starts.push(a)
  if (starts[starts.length - 1]! + L < ns) starts.push(ns - L)
  const W = starts.length

  const minOffset = -(ns - L)
  const maxOffset = nv - L
  const offsetCount = maxOffset - minOffset + 1
  /** z[w * offsetCount + (d - minOffset)], NaN where the window does not fit in the video. */
  const z = new Float32Array(W * offsetCount).fill(Number.NaN)
  const seedOffsets = new Set<number>()

  for (let w = 0; w < W; w++) {
    const a = starts[w]!
    const lo = Math.max(minOffset, -a)
    const hi = Math.min(maxOffset, nv - L - a)
    const count = hi - lo + 1
    if (count <= 1) continue
    let mean = 0
    const raw = new Float32Array(count)
    for (let d = lo; d <= hi; d++) {
      const s = diagSum(a, a + d, L) / L
      raw[d - lo] = s
      mean += s
    }
    mean /= count
    let variance = 0
    for (const s of raw) variance += (s - mean) ** 2
    const std = Math.sqrt(variance / count) || 1
    const row = w * offsetCount
    for (let d = lo; d <= hi; d++) z[row + d - minOffset] = (raw[d - lo]! - mean) / std

    const order = Array.from(raw.keys()).sort((x, y) => raw[y]! - raw[x]!)
    const separation = Math.round(1.5 / hop)
    const picked: number[] = []
    for (const idx of order) {
      if (picked.length >= seeds) break
      const d = idx + lo
      if ((raw[idx]! - mean) / std < seedScore) break
      if (picked.some((p) => Math.abs(p - d) < separation)) continue
      picked.push(d)
      seedOffsets.add(d)
    }
  }

  /** Best z within ±1 frame of offset d for window w (chroma peaks are a little broad). */
  const zAt = (w: number, d: number) => {
    let best = Number.NaN
    for (let dd = d - 1; dd <= d + 1; dd++) {
      if (dd < minOffset || dd > maxOffset) continue
      const v = z[w * offsetCount + dd - minOffset]!
      if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) best = v
    }
    return best
  }

  // --- 3. runs: windows where the smoothed z at a seed offset clears nullScore
  const runs: Run[] = []
  const seen = new Set<string>()
  for (const d of seedOffsets) {
    const smoothed = new Float32Array(W)
    for (let w = 0; w < W; w++) {
      let sum = 0
      let n = 0
      for (let k = w - 1; k <= w + 1; k++) {
        if (k < 0 || k >= W) continue
        const v = zAt(k, d)
        if (Number.isNaN(v)) continue
        sum += v
        n++
      }
      smoothed[w] = n === 0 || Number.isNaN(zAt(w, d)) ? Number.NEGATIVE_INFINITY : sum / n
    }
    let w = 0
    while (w < W) {
      if (!(smoothed[w]! > nullScore)) {
        w++
        continue
      }
      const w0 = w
      const zs: number[] = []
      while (w < W && smoothed[w]! > nullScore) {
        zs.push(zAt(w, d))
        w++
      }
      const w1 = w - 1
      const key = `${Math.round(d / 2)}:${w0}:${w1}`
      if (w1 - w0 + 1 >= minRunWindows && !seen.has(key)) {
        seen.add(key)
        runs.push({ offset: d, w0, w1, zs, gain: zs.reduce((sum, v) => sum + v - nullScore, 0) })
      }
    }
  }
  if (runs.length === 0) return EMPTY

  // --- 4. chain runs: song order, video order, Σgain − jumps.
  // A run may be trimmed at its start so that it begins after its predecessor
  // (repeated choruses often make a run "reach back" into material the video
  // already played). Future compatibility depends only on a run's end, so the
  // DP stays exact over (run, best predecessor).
  runs.sort((x, y) => x.w0 - y.w0 || y.gain - x.gain)
  const center = (w: number) => starts[w]! + L / 2
  const suffixGain = runs.map((r) => {
    const out = new Array<number>(r.zs.length + 1).fill(0)
    for (let k = r.zs.length - 1; k >= 0; k--) out[k] = out[k + 1]! + r.zs[k]! - nullScore
    return out
  })
  const best = runs.map((r) => r.gain)
  const prev = runs.map(() => -1)
  const startOf = runs.map((r) => r.w0)
  // Relax until stable: a predecessor's best can improve after a successor read it.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (let j = 0; j < runs.length; j++) {
      const b = runs[j]!
      for (let i = 0; i < runs.length; i++) {
        if (i === j) continue
        const a = runs[i]!
        if (a.w1 >= b.w1) continue
        const aSong = center(a.w1)
        const aVideo = aSong + a.offset
        let ws = b.w0
        while (ws <= b.w1 && !(center(ws) > aSong && center(ws) + b.offset > aVideo)) ws++
        if (ws > b.w1 || b.w1 - ws + 1 < minRunWindows) continue
        const sameOffset = Math.abs(a.offset - b.offset) <= 1
        const total = best[i]! - (sameOffset ? 0 : jumpPenalty) + suffixGain[j]![ws - b.w0]!
        if (total > best[j]! + 1e-9) {
          best[j] = total
          prev[j] = i
          startOf[j] = ws
          changed = true
        }
      }
    }
    if (!changed) break
  }
  let tail = 0
  for (let j = 1; j < runs.length; j++) if (best[j]! > best[tail]!) tail = j
  const chain: Array<{ offset: number; w0: number; w1: number; meanZ: number }> = []
  const guard = new Set<number>()
  for (let j = tail; j !== -1 && !guard.has(j); j = prev[j]!) {
    guard.add(j)
    const r = runs[j]!
    const zs = r.zs.slice(startOf[j]! - r.w0)
    chain.unshift({ offset: r.offset, w0: startOf[j]!, w1: r.w1, meanZ: zs.reduce((x, y) => x + y, 0) / zs.length })
  }

  // Merge consecutive runs that share an offset (a brief dip, not a real cut).
  const merged: Array<{ offset: number; w0: number; w1: number; zWeighted: number; windows: number }> = []
  for (const run of chain) {
    const last = merged[merged.length - 1]
    const windows = run.w1 - run.w0 + 1
    if (last && Math.abs(last.offset - run.offset) <= 1 && run.w0 - last.w1 <= Math.ceil(12 / (step * hop))) {
      last.w1 = run.w1
      last.zWeighted += run.meanZ * windows
      last.windows += windows
    } else {
      merged.push({ offset: run.offset, w0: run.w0, w1: run.w1, zWeighted: run.meanZ * windows, windows })
    }
  }

  // --- 5. frame extents and boundaries
  const frameSegs = merged.map((m) => ({
    start: m.w0 === 0 ? 0 : starts[m.w0]! + Math.floor((L - step) / 2),
    end: m.w1 === W - 1 ? ns : starts[m.w1]! + L - Math.floor((L - step) / 2),
    offset: m.offset,
    score: m.zWeighted / m.windows,
  }))
  // keep inside the video
  for (const s of frameSegs) {
    s.start = Math.max(s.start, -s.offset, 0)
    s.end = Math.min(s.end, nv - s.offset, ns)
  }
  // Boundaries between neighbours. Window-based extents are only accurate to
  // about half a window: a run keeps scoring while its window still half
  // overlaps matching audio, and the chain trims the next run to start after
  // it, so contiguous spans come out abutting at a point up to L/2 late.
  const frameSim = (i: number, d: number) =>
    i >= 0 && i < ns && i + d >= 0 && i + d < nv ? diagSum(i, i + d, 1) : -1
  const smoothSim = (i: number, d: number) => {
    let sum = 0
    let n = 0
    for (let k = i - 2; k <= i + 2; k++) {
      const v = frameSim(k, d)
      if (v === -1) continue
      sum += v
      n++
    }
    return n === 0 ? -1 : sum / n
  }
  for (let k = 1; k < frameSegs.length; k++) {
    const a = frameSegs[k - 1]!
    const b = frameSegs[k]!
    if (b.start - a.end > step) {
      // gap in the song: song material cut from the video. Pull back edges
      // that clearly do not match, then extend them while similarity holds.
      while (a.end - 1 > a.start && smoothSim(a.end - 1, a.offset) < 0.3) a.end--
      while (b.start + 1 < b.end && smoothSim(b.start, b.offset) < 0.3) b.start++
      while (a.end < b.start && frameSim(a.end, a.offset) > 0.6) a.end++
      while (b.start > a.end && frameSim(b.start - 1, b.offset) > 0.6) b.start--
      continue
    }
    // contiguous or overlapping: split where the two diagonals trade places,
    // searching half a window either side of the window-based estimate
    const margin = Math.round(L / 2)
    const lo = Math.max(a.start + 1, Math.min(a.end, b.start) - margin, -a.offset)
    const hi = Math.min(b.end - 1, Math.max(a.end, b.start) + margin, nv - b.offset)
    if (hi <= lo) continue
    let bestSplit = Math.min(Math.max(b.start, lo), hi)
    let bestValue = Number.NEGATIVE_INFINITY
    for (let split = lo; split <= hi; split++) {
      const leftOk = lo + a.offset >= 0 && split - 1 + a.offset < nv
      const rightOk = split + b.offset >= 0 && hi - 1 + b.offset < nv
      if (!leftOk || !rightOk) continue
      const value = diagSum(lo, lo + a.offset, split - lo) + diagSum(split, split + b.offset, hi - split)
      if (value > bestValue) {
        bestValue = value
        bestSplit = split
      }
    }
    a.end = bestSplit
    b.start = bestSplit
  }
  // the video must not run backwards across a boundary
  for (let k = 1; k < frameSegs.length; k++) {
    const a = frameSegs[k - 1]!
    const b = frameSegs[k]!
    const overlap = a.end + a.offset - (b.start + b.offset)
    if (overlap > 0) b.start += overlap
  }

  const minFrames = Math.round((options.minSegmentSeconds ?? 3) / hop)
  const kept = frameSegs.filter((s) => s.end - s.start >= minFrames)

  // --- 6. fine offsets
  const refinement: Array<"waveform" | "onset" | "chroma"> = []
  const round = (x: number) => Math.round(x * 1000) / 1000
  const segments: AlignmentSegment[] = kept.map((s) => {
    const songStart = s.start * hop
    const songEnd = Math.min(song.durationSeconds, s.end * hop)
    const coarse = s.offset * hop
    const fine = refineOffset(song, video, songStart, songEnd, coarse)
    refinement.push(fine.method)
    const offset = fine.offset
    return {
      songStart: round(Math.max(0, songStart)),
      songEnd: round(songEnd),
      videoStart: round(Math.max(0, songStart + offset)),
      videoEnd: round(Math.min(video.durationSeconds, songEnd + offset)),
      offset: round(offset),
      score: Math.round(s.score * 100) / 100,
    }
  })

  const matched = segments.reduce((sum, s) => sum + (s.songEnd - s.songStart), 0)
  const meanZ = matched > 0 ? segments.reduce((sum, s) => sum + s.score * (s.songEnd - s.songStart), 0) / matched : 0
  return {
    segments,
    coverage: Math.min(1, matched / song.durationSeconds),
    confidence: Math.max(0, Math.min(1, (meanZ - nullScore) / 5)),
    refinement,
  }
}

/**
 * Refine a coarse (chroma, ~93 ms) offset.
 * 1. Waveform: normalised cross-correlation of several 3 s snippets on the
 *    ~5.5 kHz decimated signals, ±0.75 s. Identical masters correlate at r≈1;
 *    under added dialogue/SFX the snippets correlate weakly but agree on the lag.
 * 2. Onset envelope: same search on the onset-strength curves (different mixes).
 * 3. Otherwise keep the chroma estimate.
 */
export const refineOffset = (
  song: AlignmentFeatures,
  video: AlignmentFeatures,
  songStart: number,
  songEnd: number,
  coarse: number,
): { offset: number; method: "waveform" | "onset" | "chroma" } => {
  const usable = songEnd - songStart - 2
  if (usable < 3) return { offset: coarse, method: "chroma" }
  const snippets = Math.max(1, Math.min(5, Math.floor(usable / 6)))
  const centers = Array.from({ length: snippets }, (_, k) => songStart + 1 + ((k + 0.5) * usable) / snippets)

  const search = (
    a: Float32Array,
    b: Float32Array,
    rate: number,
    snippetSeconds: number,
    radiusSeconds: number,
  ): Array<{ lag: number; r: number }> =>
    centers.map((c) => {
      const n = Math.floor(snippetSeconds * rate)
      const a0 = Math.floor((c - snippetSeconds / 2) * rate)
      const radius = Math.floor(radiusSeconds * rate)
      const base = Math.round((c - snippetSeconds / 2 + coarse) * rate)
      if (a0 < 0 || a0 + n > a.length) return { lag: 0, r: -1 }
      let aNorm = 0
      for (let i = 0; i < n; i++) aNorm += a[a0 + i]! ** 2
      let bestLag = 0
      let bestR = -1
      for (let lag = -radius; lag <= radius; lag++) {
        const b0 = base + lag
        if (b0 < 0 || b0 + n > b.length) continue
        let dot = 0
        let bNorm = 0
        for (let i = 0; i < n; i++) {
          const v = b[b0 + i]!
          dot += a[a0 + i]! * v
          bNorm += v * v
        }
        const r = dot / (Math.sqrt(aNorm * bNorm) || 1)
        if (r > bestR) {
          bestR = r
          bestLag = lag
        }
      }
      return { lag: bestLag / rate, r: bestR }
    })

  const median = (values: number[]) => {
    const sorted = [...values].sort((x, y) => x - y)
    return sorted[Math.floor(sorted.length / 2)]!
  }

  const majority = Math.ceil(snippets / 2)
  const waveAll = search(song.decimated, video.decimated, song.decimatedRate, 3, 0.75)
  const wave = waveAll.filter((x) => x.r >= 0.6)
  if (wave.length >= majority) return { offset: coarse + median(wave.map((x) => x.lag)), method: "waveform" }
  // Same master under a louder mix (dialogue, SFX, crowd): each snippet only correlates weakly, but
  // independent snippets agreeing on one lag to within ~10 ms out of ±0.75 s is no coincidence.
  const weak = waveAll.filter((x) => x.r >= 0.25)
  if (weak.length >= Math.max(2, majority)) {
    const center = median(weak.map((x) => x.lag))
    const agreeing = weak.filter((x) => Math.abs(x.lag - center) <= 0.012)
    if (agreeing.length >= Math.max(2, majority)) {
      return { offset: coarse + median(agreeing.map((x) => x.lag)), method: "waveform" }
    }
  }

  const onsetRate = 1 / song.onsetHopSeconds
  const onset = search(song.onset, video.onset, onsetRate, 6, 0.75).filter((x) => x.r >= 0.35)
  if (onset.length >= Math.ceil(snippets / 2)) {
    const lags = onset.map((x) => x.lag)
    const spread = Math.max(...lags) - Math.min(...lags)
    if (spread < 0.08) return { offset: coarse + median(lags), method: "onset" }
  }
  return { offset: coarse, method: "chroma" }
}
