import * as NodeFs from "node:fs"
import * as NodePath from "node:path"

/**
 * Locate the monorepo root by walking up from the working directory until a
 * `turbo.json` is found. Works from the repo root (pipeline), `apps/web`
 * (Next.js) and `apps/stories` (Astro), and survives bundling, unlike
 * `import.meta.url`.
 */
export const findRepoRoot = (from: string = process.cwd()): string => {
  let dir = NodePath.resolve(/*turbopackIgnore: true*/ from)
  for (;;) {
    if (NodeFs.existsSync(NodePath.join(/*turbopackIgnore: true*/ dir, "turbo.json"))) return dir
    const parent = NodePath.dirname(dir)
    if (parent === dir) return NodePath.resolve(/*turbopackIgnore: true*/ from)
    dir = parent
  }
}

/** `RIOT_MUSIC_DB` overrides the default `data/riot-music.db`. */
export const databasePath = (): string =>
  process.env.RIOT_MUSIC_DB ?? NodePath.join(/*turbopackIgnore: true*/ findRepoRoot(), "data", "riot-music.db")

/** `RIOT_MUSIC_MEDIA` overrides the default `media/` folder. */
export const mediaRoot = (): string => process.env.RIOT_MUSIC_MEDIA ?? NodePath.join(/*turbopackIgnore: true*/ findRepoRoot(), "media")
