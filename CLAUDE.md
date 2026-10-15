@AGENTS.md

# Riot Games Music Archive

A local archive of all music Riot Games has made: playable tracks, moving waveforms, music videos synced to the track by audio matching, artists, awards and the community's most impactful songs.

## Layout
- `apps/web` — Next.js 16 App Router: library, song pages, categories, games, artists, global player, music-video popup, `/media/*` file serving. Owns routing.
- `apps/stories` — Astro 7 (+ React islands): static `/awards` and `/impact` pages. Built output is copied into `apps/web/public` and served by Next.js rewrites.
- `packages/ui` — shared shadcn components (`@workspace/ui/components/*`, all installed via the shadcn CLI) and shared riot components (`@workspace/ui/components/riot/*`).
- `packages/db` — SQLite schema + Effect `MusicRepo` service + pure domain types (`@workspace/db`, `@workspace/db/domain/*`).
- `packages/pipeline` — Effect CLI: `npm run pipeline -- <command>` (enumerate, download-audio, download-video, catalog, analyze, covers, align, gifs, build-db, timeline).
- `/timeline` — every song on half-visible vinyls (one per game / collection), in release order: `npm run pipeline -- timeline` merges `catalog.json` + `data/curated/timeline/` (taxonomy, research, extras, associations) + media into git-ignored `data/timeline.json`, served by `/api/timeline` (`apps/web/lib/server/timeline.ts`).
- `data/` — committed inputs: `sources/*.tsv` (channel listings), `curated/*` (research: taxonomy, video classes, awards, impact stories), `catalog.json`. `data/riot-music.db` is generated (git-ignored).
- `media/` — git-ignored downloads and derived files (`audio/`, `video/`, `thumbs/`, `meta/` yt-dlp info json, `covers/`, `gifs/`, `clips/`, `analysis/`).

## Effect v4 (effect@4.0.4) — differs from v3
- Services: `class X extends Context.Service<X, Shape>()("id") {}`, build with `Layer.effect(X, effect)`, construct with `X.of({...})`, access with `yield* X`.
- Errors: `Data.TaggedError("Tag")<{...}>`; `Effect.catchTag`, `Effect.catch` (catch-all), `Effect.mapError`; `Effect.result` replaces `Effect.either`.
- Retry: `Effect.retry({ schedule, while, times })`; intersect schedules with `Schedule.max([a, b])`.
- Modules: `effect/sql` (SqlClient), `effect/cli` (Command, Flag, Argument), `effect/process` (ChildProcess, ChildProcessSpawner); `@effect/platform-node` (NodeServices.layer, NodeRuntime.runMain); `@effect/sql-sqlite-node` (SqliteClient on `node:sqlite`).
- When unsure, read `node_modules/effect/dist/<Module>.d.ts` — never assume a v3 API exists.

## Conventions
- TypeScript strict, ESM, `.ts` extensions in relative imports inside packages; Prettier style: no semicolons, double quotes, 2 spaces, width 120.
- Run TS scripts with `tsx`. Typecheck with `npx tsc -p <package> --noEmit`. Tests: vitest 5 + `@effect/vitest`.
- Child processes (yt-dlp, ffmpeg, ffprobe) go through `packages/pipeline/src/services/Process.ts`.
- YouTube: keep total yt-dlp concurrency ≤ 5; the Ytdlp service already prefers the `web_embedded` client and backs off on the bot wall. Never use browser cookies.
- Spotify is metadata only (DRM) — never fetch audio from it.
