/**
 * Muted looping clip for the featured moment of a story. Plays either a
 * pre-rendered clip file or just the `segment` of the full music video (so a
 * scene like Awaken's 3:07 can be shown before the pipeline renders clips).
 * Only plays while on screen; honours prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

export interface ClipLoopProps {
  readonly src: string
  readonly poster: string | null
  readonly segment: { readonly start: number; readonly end: number } | null
  readonly label: string
  readonly className?: string
}

export default function ClipLoop({ src, poster, segment, label, className }: ClipLoopProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const start = segment?.start ?? 0
    const end = segment?.end ?? Number.POSITIVE_INFINITY

    const toStart = () => {
      if (segment) video.currentTime = start
    }
    const onTime = () => {
      // Loop inside the segment (the element's own `loop` only knows the whole file).
      if (segment && (video.currentTime >= end || video.currentTime < start - 0.5)) video.currentTime = start
    }
    const onPlaying = () => setReady(true)
    video.addEventListener("loadedmetadata", toStart)
    video.addEventListener("timeupdate", onTime)
    video.addEventListener("playing", onPlaying)

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (video.preload !== "auto") {
            video.preload = "auto"
            if (video.readyState === 0) video.load()
          }
          void video.play().catch(() => undefined)
        } else {
          video.pause()
        }
      },
      { threshold: 0.35 },
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      video.removeEventListener("loadedmetadata", toStart)
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("playing", onPlaying)
    }
  }, [segment, src])

  return (
    <div className={cn("absolute inset-0", className)}>
      {poster ? (
        <img
          src={poster}
          alt=""
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-700", ready && "opacity-0")}
        />
      ) : null}
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        muted
        playsInline
        loop={!segment}
        preload="none"
        aria-label={label}
        className="absolute inset-0 size-full object-cover"
      />
    </div>
  )
}
