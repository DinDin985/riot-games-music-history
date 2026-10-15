import { Skeleton } from "@workspace/ui/components/skeleton"

/** Song page skeleton in the hero's shape: cover, title block, mirrored waveform bars. */
export default function SongLoading() {
  const n = 61
  return (
    <div aria-busy="true" aria-label="Loading song" className="bg-riot-radial">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-4 pt-8 pb-10 md:px-6">
        <Skeleton className="h-4 w-48 bg-white/[0.06]" />
        <div className="grid items-end gap-6 sm:grid-cols-[minmax(0,13rem)_1fr] md:gap-10 lg:grid-cols-[minmax(0,17rem)_1fr]">
          <Skeleton className="aspect-square w-40 rounded-2xl bg-white/[0.07] sm:w-full" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-3 w-32 bg-white/[0.06]" />
            <Skeleton className="h-20 w-full max-w-xl bg-white/[0.07]" />
            <Skeleton className="h-5 w-56 bg-white/[0.06]" />
            <div className="flex gap-2">
              <Skeleton className="h-12 w-36 rounded-full bg-white/[0.08]" />
              <Skeleton className="h-12 w-52 rounded-full bg-white/[0.05]" />
            </div>
          </div>
        </div>
        <div aria-hidden className="flex h-36 items-center justify-center gap-[5px] sm:h-48 md:h-60">
          {Array.from({ length: n }, (_, i) => {
            const u = (i - (n - 1) / 2) / ((n - 1) / 2)
            const env = 0.08 + 0.92 * Math.exp(-(u * u) / (2 * 0.34 * 0.34))
            return (
              <span
                key={i}
                className="w-[3px] animate-pulse rounded-full bg-white"
                style={{ height: `${Math.max(4, env * 90)}%`, opacity: 0.1 + 0.55 * env, animationDelay: `${Math.abs(u) * 500}ms` }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
