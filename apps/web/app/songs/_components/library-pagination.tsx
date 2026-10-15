"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@workspace/ui/components/pagination"
import { cn } from "@workspace/ui/lib/utils"
import { libraryHref, pageWindow, type LibraryState } from "./library-params"
import { useLibraryTransition } from "./library-transition"

/**
 * shadcn Pagination for the library. Real `<Link>`s (prefetch, open in new
 * tab, crawlable), but a plain click runs through the shared transition so the
 * results dim while the next page renders, then scrolls back to the results.
 */
export function LibraryPagination({
  state,
  totalPages,
  scrollTargetId,
}: {
  readonly state: LibraryState
  readonly totalPages: number
  /** Element scrolled into view after changing page. */
  readonly scrollTargetId: string
}) {
  const { navigate } = useLibraryTransition()
  if (totalPages <= 1) return null
  const current = Math.min(state.page, totalPages)

  const go = (page: number) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(libraryHref(state, { page }))
    const target = document.getElementById(scrollTargetId)
    if (target && target.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    }
  }

  const edge = "h-9 rounded-full px-3 text-sm"
  return (
    <Pagination className="mt-10">
      <PaginationContent className="flex-wrap justify-center gap-1">
        <PaginationItem>
          {current > 1 ? (
            <Button asChild variant="ghost" className={edge}>
              <Link href={libraryHref(state, { page: current - 1 })} onClick={go(current - 1)} aria-label="Go to previous page" rel="prev">
                <ChevronLeftIcon data-icon="inline-start" />
                <span className="hidden sm:block">Previous</span>
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" className={edge} disabled aria-label="Go to previous page">
              <ChevronLeftIcon data-icon="inline-start" />
              <span className="hidden sm:block">Previous</span>
            </Button>
          )}
        </PaginationItem>
        {pageWindow(current, totalPages).map((page, i) =>
          page === null ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={page}>
              <Button
                asChild
                variant={page === current ? "outline" : "ghost"}
                size="icon"
                className={cn(
                  "size-9 rounded-full tabular-nums",
                  page === current && "border-gold/50 bg-gold/10 text-gold dark:border-gold/50 dark:bg-gold/10",
                )}
              >
                <Link
                  href={libraryHref(state, { page })}
                  onClick={go(page)}
                  aria-current={page === current ? "page" : undefined}
                  aria-label={`Page ${page}`}
                  data-slot="pagination-link"
                >
                  {page}
                </Link>
              </Button>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          {current < totalPages ? (
            <Button asChild variant="ghost" className={edge}>
              <Link href={libraryHref(state, { page: current + 1 })} onClick={go(current + 1)} aria-label="Go to next page" rel="next">
                <span className="hidden sm:block">Next</span>
                <ChevronRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" className={edge} disabled aria-label="Go to next page">
              <span className="hidden sm:block">Next</span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
