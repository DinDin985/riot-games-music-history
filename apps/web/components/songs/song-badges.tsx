import Link from "next/link"
import { cn } from "@workspace/ui/lib/utils"
import { categoryInfo, gameInfo } from "@/lib/taxonomy"

/**
 * Small pills for a song's game and category. With `link` (default true) they
 * navigate to /games/<id> and /categories/<id>. Safe in Server and Client Components.
 */
export function GameBadge({
  gameId,
  link = true,
  short = false,
  className,
}: {
  readonly gameId: string
  readonly link?: boolean
  /** Use the short name ("LoL", "VAL"). */
  readonly short?: boolean
  readonly className?: string
}) {
  if (!gameId) return null
  const game = gameInfo(gameId)
  const classes = cn(
    "relative z-10 inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 text-[11px] font-medium whitespace-nowrap text-foreground/85 transition-colors",
    link && "hover:border-white/25 hover:text-foreground",
    className,
  )
  const content = (
    <>
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: game.color }} />
      {short ? game.short : game.name}
    </>
  )
  return link ? (
    <Link href={`/games/${game.id}`} className={classes} title={game.name}>
      {content}
    </Link>
  ) : (
    <span className={classes} title={game.name}>
      {content}
    </span>
  )
}

export function CategoryBadge({
  categoryId,
  link = true,
  className,
}: {
  readonly categoryId: string
  readonly link?: boolean
  readonly className?: string
}) {
  if (!categoryId) return null
  const category = categoryInfo(categoryId)
  const classes = cn(
    "relative z-10 inline-flex h-5 shrink-0 items-center rounded-full bg-gold/12 px-2 text-[11px] font-medium whitespace-nowrap text-gold transition-colors",
    link && "hover:bg-gold/20",
    className,
  )
  return link ? (
    <Link href={`/categories/${category.id}`} className={classes} title={category.description || category.name}>
      {category.name}
    </Link>
  ) : (
    <span className={classes} title={category.description || category.name}>
      {category.name}
    </span>
  )
}
