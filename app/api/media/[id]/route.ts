// app/api/media/[id]/route.ts
// THE generic media-serving route (Phase 11, item 0): one GET that serves ANY MediaAsset by
// id from the mounted volume, reused by every consumer (part/set images, event header
// images, proposal attachments) instead of a per-feature serving route.
//
// DECISION (issue #38, deliberate — documented here as the ADR substitute): MediaAsset rows
// stay PUBLICLY accessible without auth. Rationale: part/set images, event banners and other
// catalog-adjacent assets must be embeddable from public pages exactly like the catalog
// itself (private surfaces only ever LINK their assets — visibility lives on the surface,
// not the bytes). Splitting avatars into a separate table/route would buy little: an avatar
// id is only ever learned from the (publicly visible-by-choice) profile anyway. The residual
// risk — unauthenticated BULK enumeration/scraping of ids — is mitigated by the IP rate
// limit below (ids are unguessable UUIDs, so scraping is rate-bound, not enumeration-bound).
// Revisit only if avatars ever become privacy-gated.
import { prisma } from '@/lib/db'
import { readMediaFile } from '@/lib/media'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/getClientIp'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Ctx) {
  // [REVIEW-FIX: backend-security #38] public-by-design route, but not unbounded: 300/min/IP
  // makes mass scraping/throttling of avatar/catalog assets expensive while leaving normal
  // page loads (each asset is browser-cached immutable for a year) untouched.
  const ip = getClientIp(req)
  const { allowed } = await rateLimit(`media:get:${ip}`, 300, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

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
