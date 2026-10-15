"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet"
import { siteNav, type SiteNavItem } from "@workspace/ui/lib/site-nav"
import { cn } from "@workspace/ui/lib/utils"
import { Wordmark } from "@/components/site/logo"
import { SearchTrigger } from "@/components/site/search-command"

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Next.js `<Link>` for app routes, a plain `<a>` (full page load) for the
 * Astro-rendered `/awards` and `/impact` pages.
 */
export function NavLink({
  item,
  className,
  onNavigate,
  children,
}: {
  readonly item: SiteNavItem
  readonly className?: string
  readonly onNavigate?: () => void
  readonly children?: React.ReactNode
}) {
  const pathname = usePathname() ?? "/"
  const active = isActive(pathname, item.href)
  const props = {
    className,
    "data-active": active || undefined,
    "aria-current": active ? ("page" as const) : undefined,
    onClick: onNavigate,
  }
  return item.astro ? (
    <a href={item.href} {...props}>
      {children ?? item.label}
    </a>
  ) : (
    <Link href={item.href} {...props}>
      {children ?? item.label}
    </Link>
  )
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = React.useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/75 backdrop-blur-xl supports-backdrop-filter:bg-background/60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:text-[#0c1d2e]"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 md:px-6">
        <Link href="/" className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none" aria-label="Riot Games Music Archive — home">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 md:flex lg:gap-1">
          {siteNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              className="relative rounded-md px-2 py-2 text-sm font-medium whitespace-nowrap lg:px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none data-[active]:text-foreground after:absolute after:inset-x-2 after:-bottom-[13px] lg:after:inset-x-3 after:h-0.5 after:rounded-full after:bg-gold after:opacity-0 after:transition-opacity data-[active]:after:opacity-100"
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <SearchTrigger expand="xl" className="w-9 justify-center px-0 xl:w-64 xl:justify-start xl:px-3" />
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle asChild>
                  <div>
                    <Wordmark />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-2">
                {siteNav.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    onNavigate={() => setMenuOpen(false)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground data-[active]:bg-white/[0.06] data-[active]:text-gold",
                    )}
                  />
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
