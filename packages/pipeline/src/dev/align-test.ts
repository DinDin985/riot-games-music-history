import { execFileSync } from "node:child_process"
import { songToVideo } from "@workspace/db/domain/alignment"
import { align } from "../analysis/align.ts"
import { ALIGN_SAMPLE_RATE, alignmentFeatures } from "../analysis/features.ts"

const decode = (file: string) => {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(ALIGN_SAMPLE_RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 })
  return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
}

const [songFile, videoFile] = process.argv.slice(2) as [string, string]
let t = Date.now()
const songSig = decode(songFile), videoSig = decode(videoFile)
console.log(`decode ${Date.now() - t}ms  song ${(songSig.length / ALIGN_SAMPLE_RATE).toFixed(1)}s video ${(videoSig.length / ALIGN_SAMPLE_RATE).toFixed(1)}s`)
t = Date.now()
const song = alignmentFeatures(songSig), video = alignmentFeatures(videoSig)
console.log(`features ${Date.now() - t}ms (${song.frames}/${video.frames} chroma frames)`)
t = Date.now()
const result = align(song, video)
console.log(`align ${Date.now() - t}ms  coverage ${(result.coverage * 100).toFixed(1)}%  confidence ${result.confidence.toFixed(2)}  refinement ${result.refinement.join(",")}`)
for (const s of result.segments) console.log(`  song ${s.songStart.toFixed(2)}–${s.songEnd.toFixed(2)}  →  video ${s.videoStart.toFixed(2)}–${s.videoEnd.toFixed(2)}  offset ${s.offset.toFixed(3)}  z ${s.score}`)

// Independent check: raw-waveform cross-correlation of 3 s snippets around mapped times.
const sr = ALIGN_SAMPLE_RATE
const errors: string[] = []
for (let k = 1; k <= 12; k++) {
  const st = (song.durationSeconds * k) / 13
  const m = songToVideo({ segments: result.segments }, st)
  if (m.kind !== "exact") { errors.push(`${st.toFixed(1)}s:${m.kind}`); continue }
  const n = 3 * sr, s0 = Math.floor(st * sr), search = Math.floor(0.5 * sr)
  let bestLag = 0, bestC = -Infinity, norm = 0
  for (let i = 0; i < n; i += 4) norm += songSig[s0 + i]! ** 2
  for (let lag = -search; lag <= search; lag += 2) {
    const v0 = Math.floor(m.videoTime * sr) + lag
    let c = 0, vn = 0
    for (let i = 0; i < n; i += 4) { const v = videoSig[v0 + i] ?? 0; c += songSig[s0 + i]! * v; vn += v * v }
    c /= Math.sqrt(norm * vn) || 1
    if (c > bestC) { bestC = c; bestLag = lag }
  }
  errors.push(`${st.toFixed(1)}s:${((bestLag / sr) * 1000).toFixed(0)}ms(r=${bestC.toFixed(2)})`)
}
console.log("waveform check (residual lag, correlation):", errors.join("  "))
