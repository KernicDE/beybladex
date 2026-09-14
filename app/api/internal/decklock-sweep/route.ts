// app/api/internal/decklock-sweep/route.ts (Issue #181 — "Decklock")
// Internal decklock-sweep trigger. NOT a public API: it exists so the SAME external scheduler
// that already hits POST /api/internal/cleanup-notifications and .../recompute-meta (system
// crontab on the deploy server, or a scheduled GitHub Actions workflow — see the operational-gap
// comment in lib/decklockSweep.ts) can periodically send deck-lock reminders and remove
// deck-less participants. Minimal protection: a shared secret sent as the `x-cron-secret`
// header, compared against INTERNAL_CRON_SECRET (constant-time) — the exact pattern of the
// other two internal routes.
import { timingSafeEqual } from 'node:crypto'
import { runDecklockSweep } from '@/lib/decklockSweep'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected || !provided || !constantTimeEquals(provided, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await runDecklockSweep()
  return Response.json(result)
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf)
}
