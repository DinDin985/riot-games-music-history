// @ts-check
/**
 * Copy the static story pages into the Next.js app so it can serve them:
 *   dist/awards   -> apps/web/public/awards
 *   dist/impact   -> apps/web/public/impact
 *   dist/_stories -> apps/web/public/_stories   (hashed JS/CSS/fonts)
 * Only these three folders are replaced; nothing else in `public/` is touched.
 * Next.js rewrites `/awards`, `/impact` and `/impact/:slug` to the copied
 * `index.html` files.
 */
import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import { fileURLToPath } from "node:url"

const appDir = NodePath.resolve(NodePath.dirname(fileURLToPath(import.meta.url)), "..")
const dist = NodePath.join(appDir, "dist")
const publicDir = NodePath.resolve(appDir, "..", "web", "public")
const folders = ["awards", "impact", "_stories"]

NodeFs.mkdirSync(publicDir, { recursive: true })
for (const folder of folders) {
  const from = NodePath.join(dist, folder)
  const to = NodePath.join(publicDir, folder)
  if (!NodeFs.existsSync(from)) {
    console.warn(`[stories] postbuild: ${NodePath.relative(appDir, from)} missing, skipped`)
    continue
  }
  // Replace the previous copy so stale hashed assets do not pile up.
  NodeFs.rmSync(to, { recursive: true, force: true })
  NodeFs.cpSync(from, to, { recursive: true })
  console.log(`[stories] copied ${NodePath.relative(appDir, from)} -> ${NodePath.relative(appDir, to)}`)
}
