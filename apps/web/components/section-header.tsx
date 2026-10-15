import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Section title row: display-font heading, optional description and a
 * "see all" link on the right. `astro` makes the link a full page load
 * (for /awards and /impact).
 */
export function SectionHeader({
  id,
  title,
  eyebrow,
  description,
  href,
  linkLabel = "See all",
  astro = false,
  className,
}: {
  /** id for the <h2> (target of the section's aria-labelledby). */
  readonly id?: string
  readonly title: string
  readonly eyebrow?: string
  readonly description?: string
  readonly href?: string
  readonly linkLabel?: string
  readonly astro?: boolean
  readonly className?: string
}) {
  const linkClass =
    "group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold"
  const link = href ? (
    astro ? (
      <a href={href} className={linkClass}>
        {linkLabel}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </a>
    ) : (
      <Link href={href} className={linkClass}>
        {linkLabel}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    )
  ) : null
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold tracking-[0.25em] text-gold uppercase">{eyebrow}</p>}
        <h2 id={id} className="text-4xl leading-none text-foreground md:text-5xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {link}
    </div>
  )
}
