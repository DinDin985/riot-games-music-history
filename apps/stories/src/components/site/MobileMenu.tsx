/** Mobile navigation drawer (same Sheet menu as the Next.js header), with plain <a> links. */
import { useState } from "react"
import { MenuIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet"
import { siteNav } from "@workspace/ui/lib/site-nav"
import { Wordmark } from "./Wordmark.tsx"

export default function MobileMenu({ path }: { readonly path: string }) {
  const [open, setOpen] = useState(false)
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`))
  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
            <a
              key={item.href}
              href={item.href}
              data-active={isActive(item.href) || undefined}
              aria-current={isActive(item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground data-[active]:bg-white/[0.06] data-[active]:text-gold"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
