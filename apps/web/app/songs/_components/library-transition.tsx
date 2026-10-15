"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Shares one navigation transition between the library's filter bar and its
 * results: the filter bar calls `navigate(href)`, the results dim while the
 * new page renders on the server (search-param changes keep client state, so
 * the search box keeps focus while typing).
 */
interface LibraryTransition {
  readonly isPending: boolean
  readonly navigate: (href: string, options?: { readonly scroll?: boolean }) => void
}

const Ctx = React.createContext<LibraryTransition | null>(null)

export function LibraryTransitionProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const navigate = React.useCallback(
    (href: string, options?: { readonly scroll?: boolean }) => {
      startTransition(() => router.push(href, { scroll: options?.scroll ?? false }))
    },
    [router],
  )
  const value = React.useMemo(() => ({ isPending, navigate }), [isPending, navigate])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLibraryTransition(): LibraryTransition {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("useLibraryTransition() must be used inside <LibraryTransitionProvider>")
  return ctx
}

/** Dims (and marks busy) its children while a library navigation is pending. */
export function PendingResults({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  const { isPending } = useLibraryTransition()
  return (
    <div
      aria-busy={isPending || undefined}
      data-pending={isPending || undefined}
      className={cn(
        "transition-opacity duration-200 data-[pending]:pointer-events-none data-[pending]:opacity-50 data-[pending]:delay-150",
        className,
      )}
    >
      {children}
    </div>
  )
}
