/**
 * Media files live in the git-ignored `media/` folder and are served by the
 * Next.js route handler at `/media/<path>` (with HTTP Range support). The DB
 * stores paths relative to `media/` with forward slashes, e.g. `audio/abc.m4a`.
 */
export const MEDIA_URL_PREFIX = "/media"

export const mediaUrl = (relativePath: string | null | undefined): string | null =>
  relativePath ? `${MEDIA_URL_PREFIX}/${relativePath.replace(/\\/g, "/").replace(/^\/+/, "")}` : null

export const youtubeUrl = (videoId: string, seconds?: number): string =>
  `https://www.youtube.com/watch?v=${videoId}${seconds ? `&t=${Math.floor(seconds)}s` : ""}`

export const youtubeThumbnail = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

/** Decode the base64 loudness envelope stored in `song_analysis.peaks` (values 0–255). */
export const decodePeaks = (base64: string): Uint8Array => {
  if (typeof atob === "function") {
    const binary = atob(base64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return Uint8Array.from(Buffer.from(base64, "base64"))
}
