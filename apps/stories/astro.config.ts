import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import type { Plugin } from "vite"
// Plain JS helper shared with the stand-alone media server script.
import { mediaMiddleware } from "./scripts/media-middleware.mjs"

/**
 * `/media/*` is served by the Next.js app in production. During `astro dev`
 * this plugin serves the repo's media folder directly; `astro preview` (which
 * ignores Vite plugins) proxies `/media` to `STORIES_PROXY_ORIGIN` instead.
 */
const devMedia = (): Plugin => ({
  name: "stories:dev-media",
  configureServer(server) {
    server.middlewares.use(mediaMiddleware)
  },
})

const proxyOrigin = process.env.STORIES_PROXY_ORIGIN ?? "http://localhost:3000"

export default defineConfig({
  output: "static",
  trailingSlash: "ignore",
  build: {
    // Hashed JS/CSS/fonts live under /_stories so they never collide with Next.js' /_next.
    assets: "_stories",
    format: "directory",
  },
  integrations: [react()],
  devToolbar: { enabled: false },
  // Same typefaces and CSS variables as the Next.js app (next/font Geist, Geist Mono and
  // Bebas Neue for display headings), self-hosted at build time.
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Bebas Neue",
      cssVariable: "--font-display-family",
      weights: ["400"],
      fallbacks: ["Impact", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Geist",
      cssVariable: "--font-sans",
      weights: ["100 900"],
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Geist Mono",
      cssVariable: "--font-mono",
      weights: ["400", "500"],
      fallbacks: ["ui-monospace", "monospace"],
    },
  ],
  vite: {
    // @tailwindcss/vite and Astro may resolve different copies of Vite's types.
    plugins: [tailwindcss() as unknown as Plugin, devMedia()],
    resolve: {
      // Astro's runtime needs cookie@2 (nested under node_modules/astro), but the prerender bundle
      // in dist/ would otherwise import the hoisted CommonJS cookie@0.7 from the repo root.
      noExternal: ["cookie"],
    },
    preview: {
      proxy: {
        "/media": { target: proxyOrigin, changeOrigin: true },
      },
    },
  },
})
