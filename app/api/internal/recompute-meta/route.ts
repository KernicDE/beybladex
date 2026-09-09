// app/api/internal/recompute-meta/route.ts (Phase 5 Part D)
// Internal Auto-Meta recompute trigger. NOT a public API: it exists so the SAME external
// scheduler that already hits POST /api/internal/cleanup-notifications (system crontab on the
// deploy server or a scheduled GitHub Actions workflow — see the operational-gap comments in
// lib/metaCache.ts and lib/notificationCleanup.ts) can periodically drain the dirty sets and
// refresh the win-rate cache. Minimal protection: a shared secret sent as the `x-cron-secret`
// header, compared against INTERNAL_CRON_SECRET (constant-time) — the exact pattern of the
// cleanup-notifications route.
import { timingSafeEqual } from 'node:crypto'
import { recomputeDirtyMeta } from '@/lib/metaCache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected || !provided || !constantTimeEquals(provided, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await recomputeDirtyMeta()
  return Response.json(result)
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf)
}
