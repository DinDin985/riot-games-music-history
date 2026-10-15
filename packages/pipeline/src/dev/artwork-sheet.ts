/**
 * Review contact sheet for album artwork: one row per song —
 * [cover the site shows now] [chosen/candidate artwork …] with captions.
 *
 *   npx tsx packages/pipeline/src/dev/artwork-sheet.ts --songs a,b,c --out sheet.jpg
 *   npx tsx packages/pipeline/src/dev/artwork-sheet.ts --status review --offset 0 --limit 12 --out sheet.jpg
 *
 * Reads data/curated/artwork/matches.json + data/catalog.json. Remote artwork is
 * fetched at 500 px into a cache folder (default: media/artwork/review-cache).
 */
import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import sharp from "sharp"
import { paths } from "../paths.ts"

interface MatchRow {
  readonly songId: string
  readonly status: string
  readonly chosen: { readonly source: string; readonly id: string; readonly artworkUrl: string } | null
  readonly candidates: ReadonlyArray<{
    readonly source: string
    readonly id: string
    readonly title: string
    readonly duration: number | null
    readonly album: string | null
    readonly artworkUrl: string
    readonly score: number
  }>
}

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "")

const matches = (JSON.parse(NodeFs.readFileSync(NodePath.join(paths.curated, "artwork", "matches.json"), "utf8")) as { matches: ReadonlyArray<MatchRow> }).matches
const catalog = JSON.parse(NodeFs.readFileSync(NodePath.join(paths.data, "catalog.json"), "utf8")) as {
  songs: ReadonlyArray<{ id: string; title: string; displayArtist: string; year: number | null; album: string | null; coverYoutubeId: string | null }>
}
const songsById = new Map(catalog.songs.map((s) => [s.id, s]))

const selected: ReadonlyArray<MatchRow> = args.has("songs")
  ? args.get("songs")!.split(",").flatMap((id) => matches.filter((m) => m.songId === id.trim()))
  : matches
      .filter((m) => !args.has("status") || m.status === args.get("status"))
      .slice(Number(args.get("offset") ?? 0), Number(args.get("offset") ?? 0) + Number(args.get("limit") ?? 12))

const cacheDir = args.get("cache") ?? NodePath.join(paths.media, "artwork", "review-cache")
NodeFs.mkdirSync(cacheDir, { recursive: true })
const TILE = 200
const CAPTION = 64
const MAX_CANDIDATES = 4

const escape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const caption = (lines: ReadonlyArray<string>, width: number) =>
  Buffer.from(
    `<svg width="${width}" height="${CAPTION}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0c1d2e"/>` +
      lines
        .slice(0, 4)
        .map((l, i) => `<text x="4" y="${14 + i * 15}" font-family="Arial" font-size="12" fill="${i === 0 ? "#ffffff" : "#c8d3df"}">${escape(clip(l, 30))}</text>`)
        .join("") +
      `</svg>`,
  )

const fetchArt = async (url: string): Promise<Buffer | null> => {
  const small = url.replace(/-original\.(jpg|png)$/, "-t500x500.jpg")
  const file = NodePath.join(cacheDir, `${Buffer.from(small).toString("base64url").slice(-40)}.img`)
  if (!NodeFs.existsSync(file)) {
    const res = await fetch(small).catch(() => null)
    if (!res?.ok) return null
    NodeFs.writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
  }
  return NodeFs.readFileSync(file)
}

const tile = async (image: Buffer | null, lines: ReadonlyArray<string>) => {
  const img = image
    ? await sharp(image).resize(TILE, TILE, { fit: "cover" }).toBuffer()
    : await sharp({ create: { width: TILE, height: TILE, channels: 3, background: "#333" } }).png().toBuffer()
  return sharp({ create: { width: TILE, height: TILE + CAPTION, channels: 3, background: "#0c1d2e" } })
    .composite([
      { input: img, top: 0, left: 0 },
      { input: caption(lines, TILE), top: TILE, left: 0 },
    ])
    .png()
    .toBuffer()
}

const rows: Array<Buffer> = []
for (const [i, m] of selected.entries()) {
  const song = songsById.get(m.songId)
  const currentFile = [
    NodePath.join(paths.covers, `song-${m.songId}.jpg`),
    song?.coverYoutubeId ? NodePath.join(paths.covers, `${song.coverYoutubeId}.jpg`) : "",
  ].find((f) => f && NodeFs.existsSync(f))
  const tiles = [
    await tile(currentFile ? NodeFs.readFileSync(currentFile) : null, [
      `#${i} NOW: ${song?.title ?? m.songId}`,
      song?.displayArtist ?? "",
      `${song?.year ?? "?"} · ${m.status}`,
      song?.album ?? "",
    ]),
  ]
  for (const [k, c] of m.candidates.slice(0, MAX_CANDIDATES).entries()) {
    const chosen = m.chosen && m.chosen.source === c.source && m.chosen.id === c.id
    tiles.push(
      await tile(await fetchArt(c.artworkUrl), [
        `${chosen ? "★ " : ""}${String.fromCharCode(65 + k)} ${c.title}`,
        `${c.source} ${c.id} · ${c.score}`,
        `${c.duration ? `${Math.round(c.duration)}s` : ""} ${c.album ?? ""}`,
      ]),
    )
  }
  const width = (MAX_CANDIDATES + 1) * TILE
  rows.push(
    await sharp({ create: { width, height: TILE + CAPTION, channels: 3, background: "#081420" } })
      .composite(tiles.map((input, k) => ({ input, top: 0, left: k * TILE })))
      .png()
      .toBuffer(),
  )
}

const out = args.get("out") ?? NodePath.join(cacheDir, "sheet.jpg")
const width = (MAX_CANDIDATES + 1) * TILE
await sharp({ create: { width, height: Math.max(1, rows.length) * (TILE + CAPTION), channels: 3, background: "#081420" } })
  .composite(rows.map((input, r) => ({ input, top: r * (TILE + CAPTION), left: 0 })))
  .jpeg({ quality: 82 })
  .toFile(out)
console.log(`${out}: ${rows.length} songs (${selected.map((m) => m.songId).join(", ")})`)
