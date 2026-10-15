import { DatabaseIcon } from "lucide-react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Friendly empty state for pages rendered before the pipeline has built
 * `data/riot-music.db`. Use it as:
 *
 * ```tsx
 * if (!hasDatabase()) return <DatabaseMissing />
 * ```
 */
export function DatabaseMissing({ className, title = "The archive is still being built" }: { readonly className?: string; readonly title?: string }) {
  return (
    <Empty className={cn("mx-auto my-16 max-w-2xl border border-dashed border-white/10 bg-white/[0.02] py-14", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-11 rounded-xl bg-gold/15 text-gold [&_svg:not([class*='size-'])]:size-5">
          <DatabaseIcon />
        </EmptyMedia>
        <EmptyTitle className="font-display text-3xl tracking-wide">{title}</EmptyTitle>
        <EmptyDescription>
          The song database has not been generated yet. Build it from the downloaded media, then reload this page:
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <code className="rounded-lg border border-white/10 bg-[#0a1827] px-4 py-2.5 font-mono text-sm text-gold">
          npm run pipeline -- build-db
        </code>
        <Waveform variant="card" seed="riot-music-archive" className="mt-4 h-12 w-64" aria-label="Decorative waveform" />
      </EmptyContent>
    </Empty>
  )
}
