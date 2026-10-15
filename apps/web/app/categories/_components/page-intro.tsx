import { Waveform } from "@workspace/ui/components/riot/waveform"
import { cn } from "@workspace/ui/lib/utils"
import type { HeroStat } from "./collection-hero"

/**
 * Header for the browse index pages (/categories, /games, /artists): eyebrow,
 * display title, intro text and a stat row over the navy radial glow, with
 * the archive's mirrored waveform as a quiet decoration.
 */
export function PageIntro({
  eyebrow,
  title,
  description,
  stats = [],
  seed,
  className,
  children,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description: React.ReactNode
  readonly stats?: ReadonlyArray<HeroStat>
  /** Seed for the decorative waveform shape. */
  readonly seed: string
  readonly className?: string
  readonly children?: React.ReactNode
}) {
  return (
    <section className={cn("bg-riot-radial relative overflow-hidden", className)}>
      <Waveform
        variant="hero"
        seed={seed}
        idle
        className="pointer-events-none absolute inset-x-0 top-6 mx-auto h-40 max-w-5xl opacity-[0.12] md:h-52"
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-6 px-4 pt-10 pb-8 md:px-6 md:pt-14 md:pb-10">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold tracking-[0.35em] text-gold uppercase">{eyebrow}</p>
          <h1 className="text-6xl leading-[0.9] sm:text-7xl md:text-8xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base text-pretty text-muted-foreground md:text-lg">{description}</p>
        </div>
        {stats.length > 0 && (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <dt className="order-2 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">{s.label}</dt>
                <dd className="order-1 font-display text-4xl leading-none tracking-wide">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </section>
  )
}
