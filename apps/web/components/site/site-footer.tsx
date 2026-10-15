import Link from "next/link"
import { siteNav } from "@workspace/ui/lib/site-nav"
import { Kbd } from "@workspace/ui/components/kbd"
import { Wordmark } from "@/components/site/logo"

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/[0.06] bg-[#0a1827]">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-10 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-sm text-sm text-muted-foreground">
            An unofficial, local archive of the music Riot Games has released — every track playable, every music video
            one click away.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Music, videos and artwork © Riot Games and their respective artists. Not affiliated with or endorsed by Riot
            Games.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          {siteNav.map((item) =>
            item.astro ? (
              <a key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Shortcuts</p>
          <p className="flex items-center gap-2">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> or <Kbd>/</Kbd> search
          </p>
          <p className="flex items-center gap-2">
            <Kbd>Space</Kbd> play / pause
          </p>
        </div>
      </div>
    </footer>
  )
}
