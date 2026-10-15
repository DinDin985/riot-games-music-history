import Link from "next/link"
import { cn } from "@workspace/ui/lib/utils"
import { formatNumber } from "@workspace/ui/components/riot/format"

export interface BreakdownItem {
  readonly id: string
  readonly label: string
  readonly count: number
  readonly href: string
  /** Dot colour (game colour); omitted → gold. */
  readonly color?: string
}

/**
 * Wrapping row of count chips ("Worlds Songs 38", "VALORANT 12"…) linking into
 * the filtered library. `label` names the row for screen readers.
 */
export function BreakdownChips({
  items,
  label,
  className,
}: {
  readonly items: ReadonlyArray<BreakdownItem>
  readonly label: string
  readonly className?: string
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="group inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-black/20 pr-1 pl-3 text-sm backdrop-blur transition-colors hover:border-white/30 hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: item.color ?? "var(--gold)" }} />
          <span className="font-medium text-foreground/90 group-hover:text-foreground">{item.label}</span>
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/10 px-1.5 text-xs text-foreground/80 tabular-nums">
            {formatNumber(item.count)}
          </span>
        </Link>
      ))}
    </nav>
  )
}
