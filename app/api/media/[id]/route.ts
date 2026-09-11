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
import { redis } from '@/lib/redis'

type Ctx = { params: Promise<{ id: string }> }

// [RC5 #62] Asset metadata (mimeType) is immutable per id — one row per upload id, edits upload
// a NEW asset — so a short Redis cache absorbs the repeated DB lookup hot path without any
// invalidation bookkeeping (a stale entry can only ever reference an id that no longer exists,
// which then 404s on the volume read; TTL bounds even that). Negative results (unknown id) are
// cached much shorter: a row could be created at any moment.
const META_TTL_SECONDS = 300
const META_MISS_TTL_SECONDS = 30
const metaKey = (id: string) => `media:meta:${id}`

async function loadAssetMeta(id: string): Promise<{ mimeType: string } | null | undefined> {
  try {
    const hit = await redis.get(metaKey(id))
    if (hit !== null) return hit === '0' ? null : (JSON.parse(hit) as { mimeType: string })
  } catch (err) {
    console.error(`[media] meta cache GET ${id} failed:`, err)
  }
  const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { mimeType: true } })
  try {
    await redis.set(metaKey(id), asset ? JSON.stringify(asset) : '0', 'EX', asset ? META_TTL_SECONDS : META_MISS_TTL_SECONDS)
  } catch (err) {
    console.error(`[media] meta cache SET ${id} failed:`, err)
  }
  return asset
}

export async function GET(req: Request, { params }: Ctx) {
  // [REVIEW-FIX: backend-security #38] public-by-design route, but not unbounded: 300/min/IP
  // makes mass scraping/throttling of avatar/catalog assets expensive while leaving normal
  // page loads (each asset is browser-cached immutable for a year) untouched.
  const ip = getClientIp(req)
  const { allowed } = await rateLimit(`media:get:${ip}`, 300, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  // undefined = cache unreachable AND db lookup failed to resolve state — treat as not_found,
  // never a stack trace.
  const asset = await loadAssetMeta(id)
  if (!asset) return Response.json({ error: 'not_found' }, { status: 404 })

  let data: Buffer
  try {
    data = await readMediaFile(id)
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
      // itself is the cache key, so a long immutable TTL is safe. [RC5 #62] s-maxage +
      // stale-while-revalidate extend the same contract to any shared cache in front (CDN or
      // reverse proxy): repeated anonymous hits never reach the app within a year.
      'Cache-Control': 'public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400',
    },
  })
}
