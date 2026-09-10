// lib/webPush.ts (Phase 18)
// Server-side Web Push sender — the `web-push` npm library talks directly to each browser
// vendor's own push service using the subscription's own endpoint URL (no third-party
// push-relay SaaS; this is the same browser-native mechanism every site's Web Push uses).
// VAPID keys identify this server to those push services (see .env.example for generation).
//
// Degrades gracefully (same convention as lib/mailer.ts's SMTP_HOST check): if
// VAPID_PRIVATE_KEY is unset (local dev/CI with no real keys configured), this module logs and
// no-ops instead of throwing — the rest of the notification pipeline (DB row + SSE + email)
// keeps working without it.
import webpush from 'web-push'
import { prisma } from '@/lib/db'

let configured: boolean | undefined

function ensureConfigured(): boolean {
  if (configured !== undefined) return configured
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    configured = false
  } else {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  }
  return configured
}

export interface PushPayload {
  title: string
  message: string
  link?: string
}

/** Sends `payload` to every subscription the user has (multiple devices/browsers). A dead
 *  subscription (410 Gone / 404 — the browser unsubscribed or the endpoint expired) is removed
 *  so it stops being retried forever; any other per-subscription failure is logged and skipped,
 *  never allowed to fail the caller's already-persisted notification. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return

  const body = JSON.stringify(payload)
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | null)?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        } else {
          console.error(`[webPush] send to subscription ${sub.id} failed:`, err)
        }
      }
    })
  )
}
