"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

export interface SortOption {
  readonly value: string
  readonly label: string
}

/**
 * Segmented sort switch that navigates to `?sort=<value>` (dropping `page`)
 * without scrolling, so the server re-renders the list in the new order.
 * The default value is written as no parameter at all.
 */
export function SortControl({
  options,
  value,
  defaultValue,
  label = "Sort songs",
  className,
}: {
  readonly options: ReadonlyArray<SortOption>
  readonly value: string
  readonly defaultValue: string
  readonly label?: string
  readonly className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = React.useTransition()
  // Shows the clicked option immediately; settles on `value` once the server re-rendered.
  const [optimistic, setOptimistic] = React.useOptimistic(value)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {pending && <Loader2Icon aria-hidden className="size-4 animate-spin text-muted-foreground" />}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={optimistic}
        aria-label={label}
        onValueChange={(next) => {
          if (!next || next === optimistic) return
          const href = next === defaultValue ? pathname : `${pathname}?sort=${encodeURIComponent(next)}`
          startTransition(() => {
            setOptimistic(next)
            router.push(href, { scroll: false })
          })
        }}
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="px-3 data-[state=on]:bg-gold/15 data-[state=on]:text-gold"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
