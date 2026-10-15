import type { NextRequest } from "next/server"
import type { Alignment } from "@workspace/db/domain/alignment"
import { getAlignment } from "@/lib/server/repo"
import { handle, json, notFound, safeDecode } from "@/lib/server/http"

/**
 * GET /api/songs/:id/alignment → `Alignment` between the song audio and its
 * music video (segments for songToVideo / videoToSong). 404 when the song has
 * no aligned, downloaded music video.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const alignment = await getAlignment(safeDecode(id))
    return alignment ? json<Alignment>(alignment, { maxAge: 300 }) : notFound(`Alignment for "${id}"`)
  })
}
