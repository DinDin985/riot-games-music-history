import Link from "next/link"
import { ArrowLeftIcon, SearchXIcon } from "lucide-react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Waveform } from "@workspace/ui/components/riot/waveform"
import { pluralize } from "@workspace/ui/components/riot/format"
import { libraryHref, type LibraryState } from "./library-params"

/** One way out of an empty result: drop a filter and land on `count` songs. */
export interface Relaxation {
  readonly label: string
  readonly patch: Partial<LibraryState>
  readonly count: number
}

const linkClass =
  "inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 text-sm font-medium transition-colors hover:border-gold/60 hover:text-gold focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"

/** No song matches the filters: say why, and offer the smallest change that finds something. */
export function NoResults({
  state,
  relaxations,
  description,
}: {
  readonly state: LibraryState
  readonly relaxations: ReadonlyArray<Relaxation>
  /** Human summary of the active filters ("Worlds Songs from 2012 with a music video"). */
  readonly description: string
}) {
  const useful = relaxations.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)
  return (
    <Empty className="mx-auto my-6 max-w-2xl border border-dashed border-white/10 bg-white/[0.02] py-14">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-11 rounded-xl bg-gold/15 text-gold [&_svg:not([class*='size-'])]:size-5">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle className="font-display text-3xl tracking-wide">No songs match</EmptyTitle>
        <EmptyDescription>
          Nothing in the archive is {description}.
          {useful.length > 0 ? " Loosen one filter:" : " Try a different search or clear the filters."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg">
        <Waveform variant="card" seed={`empty-${state.q}`} centerWeight={1} className="h-10 w-56 opacity-50" aria-label="Quiet waveform" />
        {useful.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-2">
            {useful.map((r) => (
              <li key={r.label}>
                <Link href={libraryHref(state, r.patch)} className={linkClass}>
                  {r.label}
                  <span className="text-xs text-muted-foreground tabular-nums">{pluralize(r.count, "song")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/songs" className="text-sm text-muted-foreground underline-offset-4 hover:text-gold hover:underline">
          Clear every filter
        </Link>
      </EmptyContent>
    </Empty>
  )
}

/** `?page=` past the last page (e.g. an old link after the catalogue changed). */
export function PageOutOfRange({ state, totalPages }: { readonly state: LibraryState; readonly totalPages: number }) {
  return (
    <Empty className="mx-auto my-6 max-w-xl border border-dashed border-white/10 bg-white/[0.02] py-12">
      <EmptyHeader>
        <EmptyTitle className="font-display text-3xl tracking-wide">This page is empty</EmptyTitle>
        <EmptyDescription>
          These filters only fill {pluralize(totalPages, "page")}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href={libraryHref(state, { page: totalPages })} className={linkClass}>
          <ArrowLeftIcon className="size-4" /> Go to page {totalPages}
        </Link>
      </EmptyContent>
    </Empty>
  )
}
