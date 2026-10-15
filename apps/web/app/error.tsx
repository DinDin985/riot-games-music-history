"use client"

import * as React from "react"
import { RotateCcwIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"

/** Error boundary for every route below the root layout (header/player stay usable). */
export default function RouteError({
  error,
  retry,
}: {
  readonly error: Error & { digest?: string }
  /** Re-fetches and re-renders the segment (Next 16.3+). */
  readonly retry: () => void
}) {
  React.useEffect(() => {
    console.error(error)
  }, [error])
  const missingDb = /DatabaseMissingError|database was not found/i.test(`${error.name} ${error.message}`)
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
      <p className="text-xs font-semibold tracking-[0.35em] text-riot-red uppercase">Something broke</p>
      <h1 className="mt-3 text-6xl leading-none">{missingDb ? "The archive is still being built" : "This page hit a wrong note"}</h1>
      <p className="mt-4 text-muted-foreground">
        {missingDb ? (
          <>
            Build the database with <code className="text-gold">npm run pipeline -- build-db</code>, then try again.
          </>
        ) : (
          "Something went wrong while loading this page. The database may be in the middle of a rebuild."
        )}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground/60">ref {error.digest}</p>}
      <Button onClick={() => retry()} className="mt-8 rounded-full px-5">
        <RotateCcwIcon /> Try again
      </Button>
    </div>
  )
}
