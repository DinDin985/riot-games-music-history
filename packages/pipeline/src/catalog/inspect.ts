/**
 * Dev helper: build the catalog in memory and print diagnostics.
 * `npx tsx packages/pipeline/src/catalog/inspect.ts [unmatched|dupes|song <id>|title <regex>]`
 */
import * as NodePath from "node:path"
import { paths } from "../paths.ts"
import { buildCatalog } from "./build.ts"
import { loadCatalogInputs, readJson } from "./inputs.ts"
import type { Catalog } from "./types.ts"

const [mode = "unmatched", arg = ""] = process.argv.slice(2)
// Same id lock as the catalog stage, so the printed ids match data/catalog.json.
const previous = readJson(NodePath.join(paths.data, "catalog.json")) as Catalog | null
const { catalog, stats } = buildCatalog(loadCatalogInputs(), { previous })
if (mode === "unmatched") for (const line of stats.videosUnmatched) console.log(line)
if (mode === "title") {
  const re = new RegExp(arg, "i")
  for (const s of catalog.songs.filter((s) => re.test(s.title)))
    console.log(`${s.id} | ${s.title} | ${s.displayArtist} | ${s.gameId} | ${s.categoryIds.join(",")} | ${s.year} | audio ${s.audio?.kind}:${s.audio?.youtubeId} | mv ${s.musicVideo?.youtubeId ?? "-"} | ${s.videos.length} videos`)
}
if (mode === "dupes")
  for (const s of catalog.songs) {
    const topic = s.videos.filter((v) => v.source.startsWith("topic_"))
    if (topic.length > 1) console.log(`${s.id}: ${topic.map((v) => `${v.youtubeId} ${v.durationSeconds}s "${v.title}"`).join(" | ")}`)
  }
if (mode === "song") console.log(JSON.stringify(catalog.songs.find((s) => s.id === arg), null, 2))
