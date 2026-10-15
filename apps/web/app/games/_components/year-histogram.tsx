import Link from "next/link"
import { pluralize } from "@workspace/ui/components/riot/format"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Songs-per-year bars (every year between the first and last, gaps included),
 * each bar linking to the library filtered to that year. Rounded bars in the
 * accent colour; pure CSS.
 */
export function YearHistogram({
  data,
  color,
  hrefFor,
  className,
}: {
  /** Oldest first. */
  readonly data: ReadonlyArray<{
    readonly year: number
    readonly count: number
  }>
  readonly color: string
  readonly hrefFor: (year: number) => string
  readonly className?: string
}) {
  if (data.length === 0) return null
  const first = data[0]!.year
  const last = data[data.length - 1]!.year
  const byYear = new Map(data.map((d) => [d.year, d.count]))
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const max = Math.max(...data.map((d) => d.count))
  const labelEvery = years.length > 16 ? 4 : years.length > 8 ? 2 : 1
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-36 items-end gap-1 sm:gap-1.5" role="list" aria-label="Songs per year">
        {years.map((year) => {
          const count = byYear.get(year) ?? 0
          const label = `${year}: ${pluralize(count, "song")}`
          return (
            <div role="listitem" key={year} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              {count > 0 ? (
                <Link
                  href={hrefFor(year)}
                  title={label}
                  aria-label={label}
                  className="group relative flex h-full flex-col justify-end rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span
                    className="relative mx-auto block w-full max-w-5"
                    style={{ height: `${Math.max(6, (count / max) * 88)}%` }}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 -top-5 text-center text-[11px] text-foreground tabular-nums opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                      {count}
                    </span>
                    <span
                      className="block size-full rounded-full opacity-75 transition-opacity group-hover:opacity-100"
                      style={{ backgroundColor: color }}
                    />
                  </span>
                </Link>
              ) : (
                <span title={label} className="mx-auto block h-1 w-full max-w-5 rounded-full bg-white/10" />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 sm:gap-1.5" aria-hidden>
        {years.map((year, i) => (
          <span key={year} className="min-w-0 flex-1 text-center text-[10px] text-muted-foreground tabular-nums">
            {i % labelEvery === 0 || year === last ? `’${String(year).slice(2)}` : ""}
          </span>
        ))}
      </div>
    </figure>
  )
}
