import * as NodeFs from "node:fs"
import * as NodePath from "node:path"
import type { NextConfig } from "next"

/**
 * Monorepo root (the folder holding `turbo.json`). Resolved from the working
 * directory so it works whether Node loads this file as ESM or CommonJS.
 */
const repoRoot = (() => {
  let dir = process.cwd()
  for (;;) {
    if (NodeFs.existsSync(NodePath.join(dir, "turbo.json"))) return dir
    const parent = NodePath.dirname(dir)
    if (parent === dir) return NodePath.resolve(process.cwd(), "../..")
    dir = parent
  }
})()

const nextConfig: NextConfig = {
  // `NEXT_DIST_DIR` lets several dev servers (one per agent / worktree) run side by side.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Workspace packages ship TypeScript sources. Next also transpiles their
  // dependencies (effect, @effect/sql-sqlite-node), so those cannot be listed in
  // `serverExternalPackages`; the driver only needs the `node:sqlite` builtin,
  // which stays external automatically.
  transpilePackages: ["@workspace/ui", "@workspace/db"],
  turbopack: {
    root: repoRoot,
  },
  // Media responses (app/media/[...path]/route.ts) send `Cache-Control: no-transform`
  // so the built-in gzip never touches byte ranges.
  poweredByHeader: false,
  async rewrites() {
    // The Astro build (apps/stories) is copied into apps/web/public; these map
    // its directory-style pages onto clean URLs. Array form = afterFiles, so
    // real files in public/ still win.
    return [
      { source: "/awards", destination: "/awards/index.html" },
      { source: "/impact", destination: "/impact/index.html" },
      { source: "/impact/:slug", destination: "/impact/:slug/index.html" },
    ]
  },
}

export default nextConfig
