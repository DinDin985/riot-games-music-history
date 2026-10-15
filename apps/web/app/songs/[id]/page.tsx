import type { Metadata } from "next"
import Link from "next/link"
import { Fragment } from "react"
import { notFound } from "next/navigation"
import { CalendarIcon, Disc3Icon, EyeIcon, GaugeIcon, TimerIcon, TrophyIcon } from "lucide-react"
import type { ArtistRef, ArtistRole, SongDetail, SongSummary } from "@workspace/db/domain/types"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { SongArtwork } from "@workspace/ui/components/riot/song-artwork"
import { formatDate, formatDuration, formatDurationLong, formatNumber, formatViews } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"
import { DatabaseMissing } from "@/components/database-missing"
import { SectionHeader } from "@/components/section-header"
import { CategoryBadge, GameBadge } from "@/components/songs/song-badges"
import { SongGrid } from "@/components/songs/song-grid"
import { getAnalysis, getRelatedSongs, getSong, hasDatabase, orFallback } from "@/lib/server/repo"
import { safeDecode } from "@/lib/server/http"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"
import { LinkedVideos } from "../_components/linked-videos"
import { SongDeepLink } from "../_components/song-deep-link"
import { SongHeroActions } from "../_components/song-hero-actions"
import { SongHeroWaveform } from "../_components/song-hero-waveform"

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const RELATED_COUNT = 12

async function loadSong(rawId: string): Promise<SongDetail | null> {
  if (!hasDatabase()) return null
  return orFallback(getSong(safeDecode(rawId)), null)
}

/** Only the `SongSummary` fields, so client components get a small, stable object. */
function summaryOf(song: SongDetail): SongSummary {
  return {
    id: song.id,
    title: song.title,
    displayArtist: song.displayArtist,
    gameId: song.gameId,
    primaryCategoryId: song.primaryCategoryId,
    categoryIds: song.categoryIds,
    year: song.year,
    duration: song.duration,
    viewCount: song.viewCount,
    isImpact: song.isImpact,
    hasAudio: song.hasAudio,
    hasVideo: song.hasVideo,
    audioUrl: song.audioUrl,
    coverUrl: song.coverUrl,
    gifUrl: song.gifUrl,
    palette: song.palette,
  }
}

/** Seconds from a query param (`87`, `87.5`, `1:27`); null when absent or invalid. */
function secondsParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const parts = raw.split(":").map((p) => Number.parseFloat(p))
  if (parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0)
  return seconds <= 24 * 3600 ? seconds : null
}

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const { id } = await params
  const song = await loadSong(id)
  if (!song) return { title: "Song not found" }
  const category = categoryInfo(song.primaryCategoryId).name
  const game = gameInfo(song.gameId).name
  return {
    title: `${song.title} — ${song.displayArtist}`,
    description:
      song.description?.trim() ||
      `${song.title} by ${song.displayArtist}${song.year ? ` (${song.year})` : ""} — ${category}, ${game}. Play it with a live waveform${
        song.hasVideo ? " and watch the music video" : ""
      }.`,
    openGraph: { title: song.title, description: `${song.displayArtist} · ${category} · ${game}`, type: "music.song" },
  }
}

export default async function SongPage({
  params,
  searchParams,
}: {
  readonly params: Params
  readonly searchParams: SearchParams
}) {
  if (!hasDatabase()) return <DatabaseMissing />
  const [{ id: rawId }, query] = await Promise.all([params, searchParams])
  const song = await loadSong(rawId)
  if (!song) notFound()

  const [analysis, related] = await Promise.all([
    orFallback(getAnalysis(song.id), null),
    orFallback(getRelatedSongs(song.id, RELATED_COUNT), []),
  ])

  const summary = summaryOf(song)
  // Playing from the song page continues through the related songs.
  const queue = [summary, ...related.filter((s) => s.audioUrl)]
  const mv = song.musicVideo

  const watch = query.watch === "1" || query.watch === "true"
  const t = secondsParam(query.t)
  const vt = secondsParam(query.vt)

  return (
    <article className="flex flex-col">
      <SongDeepLink song={summary} queue={queue} t={t} vt={vt} watch={watch} />

      <SongHero song={song} summary={summary} queue={queue} analysis={analysis} />

      <div className="mx-auto grid w-full max-w-[1600px] gap-12 px-4 pt-12 md:px-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
        <div className="flex min-w-0 flex-col gap-14">
          <section aria-labelledby="videos-heading">
            <SectionHeader
              id="videos-heading"
              eyebrow="Watch"
              title="Videos"
              description="The music video, live performances, remixes and behind-the-scenes — on YouTube."
            />
            <LinkedVideos musicVideo={mv} videos={song.videos} songTitle={song.title} />
          </section>
        </div>

        <aside className="flex flex-col gap-6" aria-label="Credits and details">
          <Credits artists={song.artists} displayArtist={song.displayArtist} />
          <Details song={song} bpm={analysis?.bpm ?? song.bpm} bpmConfidence={analysis?.bpmConfidence ?? null} />
        </aside>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mx-auto mt-16 w-full max-w-[1600px] px-4 md:px-6">
          <SectionHeader
            id="related-heading"
            eyebrow="Keep listening"
            title="Related songs"
            description="Same artists, same category or the same game."
            href={`/songs?category=${encodeURIComponent(song.primaryCategoryId)}`}
            linkLabel={`More ${categoryInfo(song.primaryCategoryId).name}`}
          />
          <SongGrid songs={related} priorityCount={0} />
        </section>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Hero

function SongHero({
  song,
  summary,
  queue,
  analysis,
}: {
  readonly song: SongDetail
  readonly summary: SongSummary
  readonly queue: ReadonlyArray<SongSummary>
  readonly analysis: Awaited<ReturnType<typeof getAnalysis>> | null
}) {
  const category = categoryInfo(song.primaryCategoryId)
  const performers = song.artists.filter((a) => a.role === "primary" || a.role === "featured")
  const otherCategories = song.categoryIds.filter((c) => c !== song.primaryCategoryId)
  const views = formatViews(song.viewCount)
  const bpm = analysis?.bpm ?? song.bpm
  const meta: ReadonlyArray<{ readonly icon: typeof CalendarIcon; readonly label: string; readonly value: string; readonly title?: string }> = [
    ...(song.year ? [{ icon: CalendarIcon, label: "Year", value: String(song.year), title: formatDate(song.releaseDate) ?? undefined }] : []),
    ...(song.album && song.album !== song.title ? [{ icon: Disc3Icon, label: "Album", value: song.album }] : []),
    ...(bpm ? [{ icon: GaugeIcon, label: "Tempo", value: `${Math.round(bpm)} BPM` }] : []),
    ...(song.duration ? [{ icon: TimerIcon, label: "Length", value: formatDuration(song.duration), title: formatDurationLong(song.duration) }] : []),
    ...(views ? [{ icon: EyeIcon, label: "YouTube", value: views, title: `${formatNumber(song.viewCount)} views` }] : []),
  ]

  return (
    <section aria-labelledby="song-title" className="relative isolate overflow-hidden">
      <HeroBackdrop song={song} />

      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-4 pt-6 pb-10 md:px-6 md:pt-8">
        <Breadcrumb>
          <BreadcrumbList className="text-white/60">
            <BreadcrumbItem>
              <BreadcrumbLink asChild className="hover:text-white">
                <Link href="/songs">Library</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild className="hover:text-white">
                <Link href={`/songs?category=${encodeURIComponent(category.id)}`}>{category.name}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate text-white/85">{song.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid items-end gap-6 sm:grid-cols-[minmax(0,13rem)_1fr] md:gap-10 lg:grid-cols-[minmax(0,17rem)_1fr]">
          <SongArtwork
            title={song.title}
            coverUrl={song.coverUrl}
            palette={song.palette}
            seed={song.id}
            priority
            className="aspect-square w-40 rounded-2xl shadow-[0_30px_60px_-20px_rgb(0_0_0/0.85)] ring-1 ring-white/15 sm:w-full"
          />

          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs font-semibold tracking-[0.3em] text-gold uppercase">
                {category.name}
                {song.isImpact && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] tracking-[0.2em]">
                    <TrophyIcon className="size-3" /> Community favourite
                  </span>
                )}
              </p>
              <h1
                id="song-title"
                className={cn(
                  "leading-[0.88] text-balance break-words text-white drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)]",
                  song.title.length > 28 ? "text-5xl md:text-6xl lg:text-7xl" : "text-6xl md:text-7xl lg:text-8xl xl:text-9xl",
                )}
              >
                {song.title}
              </h1>
              <p className="mt-2 text-lg text-white/85 md:text-xl">
                {performers.length > 0 ? <ArtistLinks artists={performers} /> : song.displayArtist}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <GameBadge gameId={song.gameId} className="h-6 bg-black/25 px-2.5 text-xs backdrop-blur" />
              <CategoryBadge categoryId={song.primaryCategoryId} className="h-6 px-2.5 text-xs" />
              {otherCategories.map((c) => (
                <CategoryBadge key={c} categoryId={c} className="h-6 bg-white/[0.06] px-2.5 text-xs text-white/80 hover:bg-white/10" />
              ))}
            </div>

            {meta.length > 0 && (
              <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {meta.map((m) => (
                  <div key={m.label} className="flex items-center gap-1.5" title={m.title}>
                    <dt className="sr-only">{m.label}</dt>
                    <m.icon aria-hidden className="size-4 text-white/50" />
                    <dd className="max-w-64 truncate text-white/85 tabular-nums">{m.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <SongHeroActions song={summary} queue={queue} youtubeMvUrl={song.musicVideo?.youtubeUrl ?? null} />
          </div>
        </div>

        <SongHeroWaveform song={summary} analysis={analysis} queue={queue} />
      </div>
    </section>
  )
}

/** Chorus GIF of the music video behind a gradient; without one, the album-cover colours (palette + blurred cover). */
function HeroBackdrop({ song }: { readonly song: SongDetail }) {
  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      {song.gifUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local /media GIF
        <img src={song.gifUrl} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
      ) : (
        <>
          <PaletteBackdrop palette={song.palette} seed={song.id} vignette={false} className="absolute inset-0 opacity-90" />
          {song.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local /media cover
            <img
              src={song.coverUrl}
              alt=""
              className="absolute inset-0 size-full scale-125 object-cover opacity-35 blur-3xl saturate-150 motion-safe:animate-palette-drift"
            />
          )}
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/70 to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/30 to-transparent" />
    </div>
  )
}

function ArtistLinks({ artists }: { readonly artists: ReadonlyArray<ArtistRef> }) {
  const primary = artists.filter((a) => a.role === "primary")
  const featured = artists.filter((a) => a.role === "featured")
  const link = (a: ArtistRef) => (
    <Link
      key={a.id}
      href={`/artists/${encodeURIComponent(a.id)}`}
      className="font-medium text-white underline-offset-4 transition-colors hover:text-gold hover:underline"
    >
      {a.name}
    </Link>
  )
  const join = (list: ReadonlyArray<ArtistRef>) =>
    list.flatMap((a, i) => (i === 0 ? [link(a)] : [<span key={`${a.id}-sep`}>{i === list.length - 1 ? " & " : ", "}</span>, link(a)]))
  return (
    <>
      {join(primary.length > 0 ? primary : featured)}
      {primary.length > 0 && featured.length > 0 && (
        <>
          <span className="text-white/60"> ft. </span>
          {join(featured)}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sections

const ROLE_ORDER: ReadonlyArray<ArtistRole> = ["primary", "featured", "remixer", "composer"]
const ROLE_LABEL: Readonly<Record<ArtistRole, string>> = {
  primary: "Performed by",
  featured: "Featuring",
  remixer: "Remixed by",
  composer: "Written & composed by",
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/)
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase()
}

function hue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

function Credits({ artists, displayArtist }: { readonly artists: ReadonlyArray<ArtistRef>; readonly displayArtist: string }) {
  const groups = ROLE_ORDER.map((role) => ({ role, list: artists.filter((a) => a.role === role) })).filter((g) => g.list.length > 0)
  return (
    <section aria-labelledby="credits-heading" className="rounded-3xl border border-white/[0.07] bg-card/40 p-5">
      <h2 id="credits-heading" className="text-3xl leading-none">
        Credits
      </h2>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{displayArtist}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.role}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{ROLE_LABEL[g.role]}</h3>
              <ul className="flex flex-col gap-1">
                {g.list.map((a) => (
                  <li key={`${g.role}-${a.id}`}>
                    <Link
                      href={`/artists/${encodeURIComponent(a.id)}`}
                      className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ring-1 ring-white/15"
                        style={{ background: `linear-gradient(135deg, oklch(0.55 0.12 ${hue(a.id)}), oklch(0.32 0.08 ${(hue(a.id) + 40) % 360}))` }}
                      >
                        {initials(a.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-gold">{a.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const AUDIO_KIND_LABEL: Readonly<Record<string, string>> = {
  topic: "Official release (YouTube Music)",
  official_audio: "Official audio upload",
  music_video: "Taken from the music video",
}

/**
 * RhythmExtractor2013 "multifeature" confidence, stored normalised to 0–1
 * (raw 0–5.32). Essentia's bands: < 1 very low, 1–1.5 low, 1.5–3.5 good, > 3.5 excellent.
 */
function tempoCertainty(normalised: number): string {
  const raw = normalised * 5.32
  return raw < 1 ? "uncertain" : raw < 1.5 ? "fairly sure" : raw < 3.5 ? "confident" : "very confident"
}

function Details({
  song,
  bpm,
  bpmConfidence,
}: {
  readonly song: SongDetail
  readonly bpm: number | null
  readonly bpmConfidence: number | null
}) {
  const rows: ReadonlyArray<{ readonly label: string; readonly value: React.ReactNode }> = [
    { label: "Game", value: <Link className="hover:text-gold" href={`/games/${encodeURIComponent(song.gameId)}`}>{gameInfo(song.gameId).name}</Link> },
    {
      label: song.categoryIds.length > 1 ? "Categories" : "Category",
      value: (
        <span>
          {(song.categoryIds.length > 0 ? song.categoryIds : [song.primaryCategoryId]).map((c, i) => (
            <Fragment key={c}>
              {i > 0 && ", "}
              <Link className="hover:text-gold" href={`/categories/${encodeURIComponent(c)}`}>
                {categoryInfo(c).name}
              </Link>
            </Fragment>
          ))}
        </span>
      ),
    },
    ...(song.album ? [{ label: "Album", value: song.album }] : []),
    ...(song.releaseDate || song.year ? [{ label: "Released", value: formatDate(song.releaseDate) ?? String(song.year) }] : []),
    ...(song.duration ? [{ label: "Length", value: formatDuration(song.duration) }] : []),
    ...(bpm
      ? [
          {
            label: "Tempo",
            value: `${bpm.toFixed(1)} BPM${bpmConfidence !== null ? ` · ${tempoCertainty(bpmConfidence)}` : ""}`,
          },
        ]
      : []),
    ...(song.viewCount !== null ? [{ label: "YouTube views", value: formatNumber(song.viewCount) }] : []),
    ...(song.audioKind
      ? [
          {
            label: "Audio source",
            value: song.audioVideoId ? (
              <a
                className="hover:text-gold"
                href={`https://www.youtube.com/watch?v=${encodeURIComponent(song.audioVideoId)}`}
                target="_blank"
                rel="noreferrer"
              >
                {AUDIO_KIND_LABEL[song.audioKind] ?? song.audioKind}
              </a>
            ) : (
              (AUDIO_KIND_LABEL[song.audioKind] ?? song.audioKind)
            ),
          },
        ]
      : []),
  ]
  return (
    <section aria-labelledby="details-heading" className="rounded-3xl border border-white/[0.07] bg-card/40 p-5">
      <h2 id="details-heading" className="text-3xl leading-none">
        About
      </h2>
      {song.description && <p className="mt-3 text-sm text-pretty whitespace-pre-line text-muted-foreground">{song.description}</p>}
      <dl className="mt-4 divide-y divide-white/[0.06] text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      {!song.hasAudio && (
        <p className="mt-4 rounded-xl bg-white/[0.04] p-3 text-xs text-muted-foreground">
          The audio for this song has not been downloaded yet, so it cannot be played in the archive.
        </p>
      )}
    </section>
  )
}
