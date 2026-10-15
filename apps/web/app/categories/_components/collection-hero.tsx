import Link from "next/link"
import type { SongSummary } from "@workspace/db/domain/types"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { PaletteBackdrop } from "@workspace/ui/components/riot/palette-backdrop"
import { cn } from "@workspace/ui/lib/utils"
import { CoverStack } from "./cover-mosaic"

export interface HeroStat {
  readonly label: string
  readonly value: string
}

/**
 * Detail-page hero shared by categories, games and artists: the top song's
 * album-cover colours as a drifting backdrop (optionally tinted with an
 * accent such as the game colour), breadcrumb, big display title,
 * description, stat row, actions, an extra slot (chips) and a fanned stack of
 * the top covers on large screens.
 */
export function CollectionHero({
  parent,
  eyebrow,
  title,
  description,
  palette,
  seed,
  accent,
  songs = [],
  stats = [],
  actions,
  media,
  children,
  className,
}: {
  readonly parent: { readonly href: string; readonly label: string }
  readonly eyebrow?: React.ReactNode
  readonly title: string
  readonly description?: React.ReactNode
  readonly palette: ReadonlyArray<string>
  readonly seed: string
  /** Glow colour (e.g. the game colour) and eyebrow colour. */
  readonly accent?: string
  /** Covers for the stack on the right (most popular first). */
  readonly songs?: ReadonlyArray<SongSummary>
  readonly stats?: ReadonlyArray<HeroStat>
  readonly actions?: React.ReactNode
  /** Replaces the cover stack (e.g. an artist avatar). Rendered before the text on small screens. */
  readonly media?: React.ReactNode
  readonly children?: React.ReactNode
  readonly className?: string
}) {
  return (
    <section className={cn("relative isolate overflow-hidden border-b border-white/[0.06]", className)}>
      <PaletteBackdrop palette={palette} seed={seed} vignette={false} className="absolute inset-0 -z-20 opacity-70" />
      {accent && (
        <div
          aria-hidden
          className="absolute -top-40 -left-24 -z-10 size-[40rem] rounded-full opacity-30 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0c1d2e]/35 via-[#0c1d2e]/75 to-[#0c1d2e]"
      />
      <div className="mx-auto max-w-[1600px] px-4 pt-6 pb-10 md:px-6 md:pt-8 md:pb-14">
        <Breadcrumb className="mb-6 md:mb-10">
          <BreadcrumbList className="text-white/60">
            <BreadcrumbItem>
              <BreadcrumbLink asChild className="hover:text-white">
                <Link href={parent.href}>{parent.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-white/85">{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          {media && <div className="shrink-0 lg:order-2">{media}</div>}
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p
                className="mb-2 text-xs font-semibold tracking-[0.3em] uppercase"
                style={{ color: accent ?? "var(--gold)" }}
              >
                {eyebrow}
              </p>
            )}
            <h1 className="text-6xl leading-[0.88] text-balance text-white drop-shadow-[0_6px_24px_rgb(0_0_0/0.45)] sm:text-7xl md:text-8xl">
              {title}
            </h1>
            {description && (
              <p className="mt-4 max-w-2xl text-base text-pretty text-white/80 md:text-lg">{description}</p>
            )}
            {stats.length > 0 && (
              <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
                {stats.map((s) => (
                  <div key={s.label} className="flex flex-col">
                    <dt className="order-2 text-[11px] tracking-[0.2em] text-white/60 uppercase">{s.label}</dt>
                    <dd className="order-1 font-display text-3xl leading-none tracking-wide text-white md:text-4xl">
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {actions && <div className="mt-7 flex flex-wrap items-center gap-2">{actions}</div>}
            {children && <div className="mt-6">{children}</div>}
          </div>
          {!media && songs.length > 0 && <CoverStack songs={songs} className="mr-10 hidden lg:block" />}
        </div>
      </div>
    </section>
  )
}
