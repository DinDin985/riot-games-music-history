/** Formatting helpers shared by Astro pages and React islands (pure, isomorphic). */

/** 187 -> "3:07", 3725 -> "1:02:05". */
export const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "2014-09-17" -> "Sep 17, 2014"; "2014-09" -> "Sep 2014"; "2014" -> "2014". Unknown shapes pass through. */
export const formatDate = (value: string | null | undefined): string | null => {
  if (!value) return null
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  const monthName = month ? MONTHS[Number(month) - 1] : undefined
  if (monthName && day) return `${monthName} ${Number(day)}, ${year}`
  if (monthName) return `${monthName} ${year}`
  return year ?? value
}

/** 457198706 -> "457.2M". */
export const formatCompact = (value: number): string =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Host name without `www.` for source links: "https://www.billboard.com/x" -> "billboard.com". */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Readable label for a taxonomy video kind ("live_performance" -> "Live performance"). */
export const kindLabel = (kind: string): string => {
  const special: Record<string, string> = {
    music_video: "Music video",
    official_audio: "Official audio",
    login_screen: "Login screen",
    champion_theme: "Champion theme",
    skin_trailer_song: "Skin trailer",
    making_of: "Making of",
    soundtrack_compilation: "Soundtrack",
    animated_short: "Animated short",
  }
  return special[kind] ?? kind.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase())
}
