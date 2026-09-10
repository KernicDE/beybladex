// app/api/media/[id]/route.ts
// THE generic media-serving route (Phase 11, item 0): one GET that serves ANY MediaAsset by
// id from the mounted volume, reused by every consumer (part/set images, event header
// images, proposal attachments) instead of a per-feature serving route. MediaAsset rows are
// public catalog adjuncts (like Parts/Builds themselves) — the row lookup is anonymous;
// the assets referenced by private surfaces are only ever linked from those surfaces.
import { prisma } from '@/lib/db'
import { readMediaFile } from '@/lib/media'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, mimeType: true },
  })
  if (!asset) return Response.json({ error: 'not_found' }, { status: 404 })

  let data: Buffer
  try {
    data = await readMediaFile(asset.id)
  } catch {
    // Row without bytes (volume lost / not mounted) — 404, never a stack trace.
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(data.byteLength),
      // Asset bytes are immutable (one file per upload id; edits upload a NEW asset) — the id
      // itself is the cache key, so a long immutable TTL is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
