import type { NextRequest } from "next/server"
import type { SongAnalysis } from "@workspace/db/domain/types"
import { getAnalysis } from "@/lib/server/repo"
import { handle, json, notFound, safeDecode } from "@/lib/server/http"

/**
 * GET /api/songs/:id/analysis → `SongAnalysis` (bpm, beats, base64 loudness
 * peaks, chorus span). 404 when the song has not been analysed yet.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const analysis = await getAnalysis(safeDecode(id))
    return analysis ? json<SongAnalysis>(analysis, { maxAge: 300 }) : notFound(`Analysis for "${id}"`)
  })
}
