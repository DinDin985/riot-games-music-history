import { ExternalLinkIcon, MonitorPlayIcon, PlayIcon } from "lucide-react"
import type { VideoKind, VideoRef } from "@workspace/db/domain/types"
import { formatCompactNumber, formatDate, formatDuration } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Every video linked to a song — the music video first, then live
 * performances, remixes, making-ofs…, then the plain audio uploads — as
 * thumbnail cards that open YouTube. Server Component (plain links).
 */
const KIND_LABEL: Readonly<Record<VideoKind, string>> = {
  music_video: "Music video",
  official_audio: "Official audio",
  lyric_video: "Lyric video",
  visualizer: "Visualizer",
  cinematic: "Cinematic",
  login_screen: "Login screen",
  champion_theme: "Champion theme",
  live_performance: "Live performance",
  remix: "Remix",
  animated_short: "Animated short",
  skin_trailer_song: "Skin trailer",
  making_of: "Making of",
  soundtrack_compilation: "Soundtrack",
  not_music: "Video",
}

const KIND_ORDER: ReadonlyArray<VideoKind> = [
  "live_performance",
  "remix",
  "making_of",
  "animated_short",
  "cinematic",
  "music_video",
  "skin_trailer_song",
  "champion_theme",
  "lyric_video",
  "visualizer",
  "login_screen",
  "soundtrack_compilation",
  "official_audio",
  "not_music",
]

function rank(v: VideoRef): number {
  // Audio uploads last; otherwise by kind, then by views.
  const base = v.role === "audio_source" ? 100 : 0
  const kind = KIND_ORDER.indexOf(v.kind)
  return base + (kind < 0 ? 50 : kind)
}

export function LinkedVideos({
  musicVideo,
  videos,
  songTitle,
}: {
  readonly musicVideo: VideoRef | null
  readonly videos: ReadonlyArray<VideoRef>
  readonly songTitle: string
}) {
  const others = [...videos]
    .filter((v) => v.kind !== "not_music")
    .sort((a, b) => rank(a) - rank(b) || (b.viewCount ?? -1) - (a.viewCount ?? -1))
  const list = musicVideo ? [musicVideo, ...others] : others

  if (list.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-muted-foreground">
        <MonitorPlayIcon className="size-5 shrink-0 text-gold" />
        No videos are linked to “{songTitle}” yet.
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {list.map((v) => (
        <li key={v.id}>
          <VideoCard video={v} featured={v.id === musicVideo?.id} />
        </li>
      ))}
    </ul>
  )
}

function VideoCard({ video, featured }: { readonly video: VideoRef; readonly featured: boolean }) {
  const label = featured ? `${KIND_LABEL[video.kind]} · in the popup` : video.role === "audio_source" ? "Audio source" : KIND_LABEL[video.kind]
  const date = formatDate(video.uploadDate)
  return (
    <a
      href={video.youtubeUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border bg-card/40 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        featured ? "border-gold/30 hover:border-gold/60" : "border-white/[0.07] hover:border-white/20",
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-navy-800">
        {/* eslint-disable-next-line @next/next/no-img-element -- local /media thumb or i.ytimg.com */}
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase backdrop-blur">
          {label}
        </span>
        {video.duration !== null && (
          <span className="absolute right-2.5 bottom-2.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {formatDuration(video.duration)}
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="grid size-12 place-items-center rounded-full bg-white/90 text-[#0c1d2e] shadow-xl">
            <PlayIcon className="size-5 translate-x-px fill-current" />
          </span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium group-hover:text-gold">{video.title}</p>
        <p className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          {video.viewCount !== null && <span>{formatCompactNumber(video.viewCount)} views</span>}
          {video.viewCount !== null && date && <span aria-hidden>·</span>}
          {date && <span>{date}</span>}
          <ExternalLinkIcon className="ml-auto size-3.5 shrink-0" aria-label="Opens YouTube" />
        </p>
      </div>
    </a>
  )
}
