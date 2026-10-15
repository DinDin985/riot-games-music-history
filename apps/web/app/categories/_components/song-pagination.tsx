import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { buttonVariants } from "@workspace/ui/components/button"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@workspace/ui/components/pagination"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Page links for a server-paginated song grid. Uses Next `<Link>` (not the
 * shadcn `<a>`), so moving between pages never reloads the document and the
 * global player keeps playing. Links jump to `#<anchor>`.
 */
export function SongPagination({
  pathname,
  page,
  pageCount,
  params = {},
  anchor = "songs",
  className,
}: {
  readonly pathname: string
  readonly page: number
  readonly pageCount: number
  /** Other query params to keep (e.g. `{ sort: "newest" }`). */
  readonly params?: Readonly<Record<string, string | undefined>>
  readonly anchor?: string
  readonly className?: string
}) {
  if (pageCount <= 1) return null
  const href = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
    if (p > 1) q.set("page", String(p))
    const qs = q.toString()
    return `${pathname}${qs ? `?${qs}` : ""}#${anchor}`
  }
  const pages = pageWindow(page, pageCount)
  const link = (p: number, active = false) =>
    cn(buttonVariants({ variant: active ? "outline" : "ghost", size: "icon" }), active && "border-gold/50 text-gold")

  return (
    <Pagination className={cn("mt-8", className)}>
      <PaginationContent>
        <PaginationItem>
          {page > 1 ? (
            <Link
              href={href(page - 1)}
              aria-label="Go to previous page"
              className={cn(buttonVariants({ variant: "ghost" }), "pl-1.5")}
            >
              <ChevronLeftIcon />
              <span className="hidden sm:block">Previous</span>
            </Link>
          ) : (
            <span
              aria-disabled
              className={cn(buttonVariants({ variant: "ghost" }), "pointer-events-none pl-1.5 opacity-40")}
            >
              <ChevronLeftIcon />
              <span className="hidden sm:block">Previous</span>
            </span>
          )}
        </PaginationItem>
        {pages.map((p, i) =>
          p === null ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <Link href={href(p)} aria-current={p === page ? "page" : undefined} className={link(p, p === page)}>
                {p}
              </Link>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          {page < pageCount ? (
            <Link
              href={href(page + 1)}
              aria-label="Go to next page"
              className={cn(buttonVariants({ variant: "ghost" }), "pr-1.5")}
            >
              <span className="hidden sm:block">Next</span>
              <ChevronRightIcon />
            </Link>
          ) : (
            <span
              aria-disabled
              className={cn(buttonVariants({ variant: "ghost" }), "pointer-events-none pr-1.5 opacity-40")}
            >
              <span className="hidden sm:block">Next</span>
              <ChevronRightIcon />
            </span>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

/** 1 … 4 5 [6] 7 8 … 20 — null marks a gap. */
function pageWindow(page: number, count: number): Array<number | null> {
  const keep = new Set([1, count, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => keep.add(p))
  if (page >= count - 2) [count - 1, count - 2, count - 3].forEach((p) => keep.add(p))
  const sorted = [...keep].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b)
  const out: Array<number | null> = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(null)
    out.push(p)
  })
  return out
}
