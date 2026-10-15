import Link from "next/link"
import { HomeIcon, LibraryIcon } from "lucide-react"
import { Waveform } from "@workspace/ui/components/riot/waveform"

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center">
      <p className="text-xs font-semibold tracking-[0.35em] text-gold uppercase">Error 404</p>
      <h1 className="mt-3 text-7xl leading-none md:text-8xl">This track went silent</h1>
      <Waveform variant="hero" seed="404" centerWeight={1} className="my-8 h-28 w-full max-w-xl opacity-70" aria-label="Flat waveform" />
      <p className="max-w-md text-muted-foreground">
        The page you are looking for is not in the archive — maybe the song was renamed, or the link is mistyped.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-gold px-5 text-sm font-semibold text-[#0c1d2e] hover:bg-[#d8ad52]"
        >
          <HomeIcon className="size-4" /> Back home
        </Link>
        <Link
          href="/songs"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-medium hover:border-gold/60 hover:text-gold"
        >
          <LibraryIcon className="size-4" /> Browse the library
        </Link>
      </div>
    </div>
  )
}
