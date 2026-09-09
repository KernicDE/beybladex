// lib/notificationCleanup.ts (Phase 3)
// GDPR Art. 5(1)(e) storage limitation for Notification rows:
//   - READ rows older than 90 days are purged.
//   - UNREAD rows older than 12 months are purged.
//
// OPERATIONAL GAP, documented per the plan: this repo has no cron/worker process (the same
// constraint lib/currency.ts will face in Phase 5), so THIS MODULE IS ONLY EVER CALLED when
// an external scheduler hits POST /api/internal/cleanup-notifications. Wiring that scheduler
// is a deploy-time operational task, not something buildable in this codebase alone:
// either a system-crontab entry on the deploy server
//   (`0 3 * * * curl -X POST -H "x-cron-secret: $INTERNAL_CRON_SECRET" https://beybladex.de/api/internal/cleanup-notifications`)
// or a GitHub Actions scheduled workflow doing the same. Until that exists, NO automatic
// purge runs — flag this in the deployment checklist.
import { prisma } from '@/lib/db'

const READ_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const UNREAD_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

export async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const readCutoff = new Date(now.getTime() - READ_RETENTION_MS)
  const unreadCutoff = new Date(now.getTime() - UNREAD_RETENTION_MS)
  const [read, unread] = await prisma.$transaction([
    prisma.notification.deleteMany({ where: { isRead: true, createdAt: { lt: readCutoff } } }),
    prisma.notification.deleteMany({ where: { isRead: false, createdAt: { lt: unreadCutoff } } }),
  ])
  return read.count + unread.count
}
