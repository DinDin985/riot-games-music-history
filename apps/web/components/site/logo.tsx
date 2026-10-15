import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Archive mark: five rounded bars mirrored on a centre line, tallest in the
 * middle — the waveform motif in miniature — plus the wordmark.
 */
export function LogoMark({ className }: { readonly className?: string }) {
  const bars = [0.38, 0.68, 1, 0.68, 0.38]
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <rect x="0" y="0" width="24" height="24" rx="6" className="fill-gold" />
      {bars.map((h, i) => {
        const height = 15 * h
        return (
          <rect
            key={i}
            x={4.6 + i * 3.4 - 0.9}
            y={12 - height / 2}
            width={1.8}
            height={height}
            rx={0.9}
            className="fill-[#0c1d2e]"
          />
        )
      })}
    </svg>
  )
}

export function Wordmark({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-7 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-xl tracking-[0.08em] text-foreground">Riot Games Music</span>
        {!compact && <span className="text-[10px] font-medium tracking-[0.32em] text-gold uppercase">Archive</span>}
      </span>
    </span>
  )
}
