import { Skeleton } from "@workspace/ui/components/skeleton"

/** Library skeleton: header, filter bar, card grid. */
export default function LibraryLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the library" className="flex flex-col">
      <div className="bg-riot-radial">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 pt-10 pb-7 md:px-6 md:pt-14">
          <Skeleton className="h-3 w-40 bg-white/[0.06]" />
          <Skeleton className="h-16 w-full max-w-md bg-white/[0.06] md:h-20" />
          <Skeleton className="h-4 w-full max-w-xl bg-white/[0.05]" />
        </div>
      </div>
      <div className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-[1600px] gap-2 overflow-hidden px-4 py-3 md:px-6">
          <Skeleton className="h-10 w-full max-w-sm shrink-0 rounded-full bg-white/[0.05]" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="hidden h-9 w-32 shrink-0 rounded-full bg-white/[0.05] lg:block" />
          ))}
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-2 gap-3 px-4 pt-10 sm:grid-cols-3 md:gap-4 md:px-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border border-white/[0.05] p-2.5">
            <Skeleton className="aspect-square w-full rounded-xl bg-white/[0.06]" />
            <Skeleton className="h-4 w-3/4 bg-white/[0.06]" />
            <Skeleton className="h-3 w-1/2 bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  )
}
