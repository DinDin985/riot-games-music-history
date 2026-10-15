import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { luminance, resolvePalette } from "@workspace/ui/components/riot/palette-backdrop"
import { cn } from "@workspace/ui/lib/utils"
import { initials } from "./artist-meta"

/**
 * Round artist picture. The archive has no artist photos, so it shows the
 * cover of the artist's most popular song; while that loads (or when there is
 * none) a gradient in that song's album colours with the artist's initials.
 */
export function ArtistAvatar({
  name,
  coverUrl,
  palette,
  className,
  textClassName,
}: {
  readonly name: string
  readonly coverUrl: string | null
  readonly palette: ReadonlyArray<string>
  /** Size it here, e.g. `size-24`. */
  readonly className?: string
  /** Initials size, e.g. `text-4xl`. */
  readonly textClassName?: string
}) {
  const colors = resolvePalette(palette)
  const byLight = [...colors].sort((a, b) => luminance(b) - luminance(a))
  const light = byLight[0]!
  const dark = byLight[byLight.length - 1]!
  return (
    <Avatar className={cn("size-12 after:hidden", className)}>
      {coverUrl && <AvatarImage src={coverUrl} alt="" loading="lazy" decoding="async" draggable={false} />}
      <AvatarFallback
        className={cn("font-display tracking-wide text-white [text-shadow:0_2px_12px_rgb(0_0_0/0.45)]", textClassName)}
        style={{
          background: `radial-gradient(120% 120% at 25% 15%, color-mix(in oklab, ${light} 85%, white) 0%, ${colors[0]} 45%, color-mix(in oklab, ${dark} 70%, #0c1d2e) 100%)`,
        }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
