import type { Metadata, Viewport } from "next"
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google"

import "@workspace/ui/globals.css"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { siteName } from "@workspace/ui/lib/site-nav"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { PlayerProvider } from "@/components/player/player-provider"
import { PlayerBar } from "@/components/player/player-bar"
import { SearchCommandProvider } from "@/components/site/search-command"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })
// Display face for h1/h2 and the `font-display` utility (see globals.css).
const fontDisplay = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display-family" })

// Every page reads data/riot-music.db, which the pipeline can rebuild at any
// time: render on each request instead of baking build-time data into HTML.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: { default: siteName, template: `%s · ${siteName}` },
  description:
    "Every song Riot Games has released — League of Legends, VALORANT, Arcane, Worlds anthems, champion themes and more — playable, with moving waveforms and music videos.",
  applicationName: siteName,
}

export const viewport: Viewport = {
  themeColor: "#0c1d2e",
  colorScheme: "dark",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontSans.variable, fontMono.variable, fontDisplay.variable, "font-sans")}
    >
      <body className="flex min-h-svh flex-col bg-background">
        <ThemeProvider defaultTheme="dark" enableSystem={false}>
          <TooltipProvider delayDuration={250}>
            <PlayerProvider>
              <SearchCommandProvider>
                <SiteHeader />
                <main id="main" className="flex-1">
                  {children}
                </main>
                <SiteFooter />
                <PlayerBar />
              </SearchCommandProvider>
            </PlayerProvider>
            <Toaster position="top-center" closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
