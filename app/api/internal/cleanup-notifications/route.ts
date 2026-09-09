// app/api/internal/cleanup-notifications/route.ts (Phase 3)
// Internal retention-purge trigger. NOT a public API: it exists so an EXTERNAL scheduler
// (system crontab on the deploy server or a scheduled GitHub Actions workflow — see the
// operational-gap comment in lib/notificationCleanup.ts) can hit the deployed server and
// purge expired Notification rows. Minimal protection: a shared secret sent as the
// `x-cron-secret` header, compared against INTERNAL_CRON_SECRET (constant-time).
import { timingSafeEqual } from 'node:crypto'
import { purgeOldNotifications } from '@/lib/notificationCleanup'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected || !provided || !constantTimeEquals(provided, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const deleted = await purgeOldNotifications()
  return Response.json({ deleted })
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf)
}
