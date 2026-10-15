import { Skeleton } from "@workspace/ui/components/skeleton"

/** Route-level loading UI: hero + card grid skeleton in the archive's shapes. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto flex w-full max-w-[1600px] flex-col gap-10 px-4 py-12 md:px-6">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="h-3 w-48 bg-white/[0.06]" />
        <Skeleton className="h-16 w-full max-w-3xl bg-white/[0.06]" />
        <LoadingBars />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border border-white/[0.05] p-2.5">
            <Skeleton className="aspect-square w-full rounded-xl bg-white/[0.06]" />
            <Skeleton className="h-4 w-3/4 bg-white/[0.06]" />
            <Skeleton className="h-3 w-1/2 bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Static mirrored bars (centre tallest) pulsing — the waveform motif without JS. */
function LoadingBars() {
  const n = 41
  return (
    <div aria-hidden className="flex h-28 w-full max-w-2xl items-center justify-center gap-[5px]">
      {Array.from({ length: n }, (_, i) => {
        const u = (i - (n - 1) / 2) / ((n - 1) / 2)
        const env = 0.1 + 0.9 * Math.exp(-(u * u) / (2 * 0.36 * 0.36))
        return (
          <span
            key={i}
            className="w-1 animate-pulse rounded-full bg-white"
            style={{
              height: `${Math.max(6, env * 100)}%`,
              opacity: 0.15 + 0.6 * env,
              animationDelay: `${Math.abs(u) * 400}ms`,
            }}
          />
        )
      })}
    </div>
  )
}
