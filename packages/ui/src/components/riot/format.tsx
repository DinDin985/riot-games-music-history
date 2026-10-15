/**
 * Formatting helpers shared by the Next.js app and the Astro pages.
 *
 * (Lives under components/ with a .tsx extension only because the
 * `@workspace/ui` exports map exposes `./components/*` as `*.tsx`; there is no
 * JSX in here and it is safe to import from server and client code.)
 */

/** `83.4` → `"1:23"`, `3725` → `"1:02:05"`. Null/NaN → `"–:––"`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "–:––"
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, "0")
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** Long form for screen readers / tooltips: `"3 min 24 s"`. */
export function formatDurationLong(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "unknown length"
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h > 0 ? `${h} h` : null, m > 0 ? `${m} min` : null, h === 0 ? `${s} s` : null].filter(Boolean).join(" ")
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en")

/** `1234567` → `"1.2M"`. */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  return compact.format(value)
}

/** `1234567` → `"1.2M views"`; null → `null` so callers can hide the label. */
export function formatViews(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return `${compact.format(value)} ${value === 1 ? "view" : "views"}`
}

/** `1234567` → `"1,234,567"`. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  return full.format(value)
}

/** `"2017-09-21"` or `"20170921"` → `"Sep 21, 2017"`; year-only stays a year. */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const v = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value
  if (/^\d{4}$/.test(v)) return v
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
}

/** `"1 song"` / `"12 songs"`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}
