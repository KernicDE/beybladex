// lib/notify.ts (Phase 3)
// Radius blast for new tournaments: durable Notification rows (the source of truth) + a
// per-user Redis pub/sub publish for the SSE stream.
//
// Privacy rules ([REVIEW-FIX: privacy-dsgvo #1], extending Task 5/7's minor-ceiling pattern):
// - Email is skipped ENTIRELY for any isMinor user, regardless of their own notifyEmail
//   setting. In-app notifications still reach minors (the inbox is inside the account).
// - Only the columns needed are selected before the JS-side haversine pass
//   ([REVIEW-FIX: performance P5]) — the DB prefilter is "has a location + a radius", the
//   precise distance check happens in haversineKm.
import type { Tournament, User } from '@prisma/client'
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { haversineKm } from '@/lib/geo'
import { sendNotificationEmail } from '@/lib/mailer'

export const notifyChannel = (userId: string) => `notify:${userId}`

/** Generic single-user notification (Phase 11): durable Notification row (source of truth) +
 *  per-user Redis pub/sub publish for the SSE stream — the same channel discipline as
 *  notifyUsersInRadius, no second notification path. In-app only (no email): proposal-review
 *  outcomes are account-internal events, not marketing blasts. */
export async function notifyUser(
  userId: string,
  content: { title: string; message: string; link: string },
): Promise<void> {
  const row = await prisma.notification.create({ data: { userId, ...content } })
  await redis.publish(notifyChannel(userId), JSON.stringify(row))
}

type NotifiableUser = Pick<
  User,
  'id' | 'latitude' | 'longitude' | 'notifyRadiusKm' | 'notifyRecurring' | 'notifyEmail' | 'isMinor' | 'email'
>

function notificationContent(t: Tournament): { title: string; message: string; link: string } {
  const date = t.startDate.toLocaleDateString('de-DE', { dateStyle: 'medium' })
  return {
    title: `Neues Turnier: ${t.title}`,
    message: `${t.locationName}, ${t.city} (${t.postalCode}) — ${date}`,
    link: `/events/${t.id}`,
  }
}

export async function notifyUsersInRadius(tournament: Tournament): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      // The organizer is not a candidate for their own tournament's radius blast.
      id: { not: tournament.createdById },
      latitude: { not: null },
      longitude: { not: null },
      notifyRadiusKm: { not: null },
    },
    select: {
      id: true, latitude: true, longitude: true, notifyRadiusKm: true,
      notifyRecurring: true, notifyEmail: true, isMinor: true, email: true,
    },
  })

  const origin = { lat: tournament.latitude, lng: tournament.longitude }
  const eligible = (candidates as NotifiableUser[]).filter((user) => {
    if (tournament.isRecurring && !user.notifyRecurring) return false
    if (user.latitude == null || user.longitude == null || user.notifyRadiusKm == null) return false
    return haversineKm(origin, { lat: user.latitude, lng: user.longitude }) <= user.notifyRadiusKm
  })

  const content = notificationContent(tournament)
  for (const user of eligible) {
    const row = await prisma.notification.create({
      data: { userId: user.id, ...content },
    })

    // Per-user channel ONLY — a global channel would leak every user's notification content
    // to every connected SSE client ([REVIEW-FIX: frontend-pwa I9]). Published with the
    // command connection; the SSE route subscribes on redisSubscriber.
    await redis.publish(notifyChannel(user.id), JSON.stringify(row))

    if (user.notifyEmail && !user.isMinor && user.email) {
      try {
        await sendNotificationEmail({
          to: user.email,
          subject: content.title,
          text: `${content.message}\n\nDetails: ${content.link}`,
        })
      } catch (err) {
        // A broken mail server must never lose or block the durable in-app notification.
        console.error(`[notify] email to ${user.id} failed:`, err)
      }
    }
  }
}
