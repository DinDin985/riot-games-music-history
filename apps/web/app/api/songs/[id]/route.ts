import type { NextRequest } from "next/server"
import type { SongDetail } from "@workspace/db/domain/types"
import { getSong } from "@/lib/server/repo"
import { handle, json, notFound, safeDecode } from "@/lib/server/http"

/** GET /api/songs/:id → `SongDetail` (404 when unknown). */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const song = await getSong(safeDecode(id))
    return song ? json<SongDetail>(song, { maxAge: 30 }) : notFound(`Song "${id}"`)
  })
}
