# Riot Games Music Archive

A local archive of the music Riot Games has made for League of Legends, VALORANT, Arcane, Teamfight Tactics, Wild Rift, 2XKO and Riot Forge. Every song is playable with a moving waveform. A music video popup opens at the same musical moment you're listening to, matched by audio rather than by time. Pages cover the library, categories, games, artists, awards, and the songs with the biggest community impact.

## Run it

```bash
npm install
npm run dev          # builds the Astro /awards + /impact pages, then starts Next.js on http://localhost:3000
```

`npm run build && npm run start` serves the production build.

The site reads `data/riot-music.db` and the git-ignored `media/` folder. To rebuild them from scratch you need Node 24, `yt-dlp`, `ffmpeg` and `ffprobe` on PATH:

```bash
npm run data:download   # list the YouTube sources, download audio + ≤1080p music videos (yt-dlp + ffmpeg)
npm run data:build      # catalog → extract-audio → analyze → covers → align → gifs → build-db
```

Each stage is idempotent, so you can re-run any of them with `npm run pipeline -- <stage>` (`--help` lists them).

## How it fits together

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16: library, song pages, categories, games, artists, global player, synced music-video dialog, `/media/*` streaming with Range support |
| `apps/stories` | Astro 7 + React islands: static `/awards` and `/impact` pages, copied into `apps/web/public` at build time |
| `packages/ui` | shadcn components (installed with the shadcn CLI) + shared Riot components (waveform, artwork, palette backdrops) |
| `packages/db` | SQLite schema, Effect v4 `MusicRepo` service, domain types, song⇄video alignment mapping |
| `packages/pipeline` | Effect v4 CLI: yt-dlp downloads, catalog, essentia.js analysis (RhythmExtractor2013 BPM/beats, loudness peaks, chorus detection), audio alignment, chorus GIFs, DB build |
| `data/` | Committed inputs: channel listings, curated research (taxonomy, video classifications, awards, impact stories), `catalog.json` |

**Music video sync.** For each song with a music video, the pipeline matches the two soundtracks with essentia HPCP chroma. It searches every offset with a diagonal-prefix similarity, chains consistent-offset runs with a dynamic program that keeps video time moving forward, and refines each run with waveform or onset cross-correlation. This produces segments that survive cut verses, inserted scenes and cold opens. The player maps song time to video time and back through those segments.

## Notes

- Spotify is used only for metadata, since its audio is DRM-protected. Audio and video come from Riot's official YouTube channels. Keep `media/` private: it's for personal, local use.
- YouTube's bot check trips quickly. The downloader prefers the `web_embedded` player client, spaces out its requests, and backs off for minutes when it sees the wall.
