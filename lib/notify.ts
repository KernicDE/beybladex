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

// Phase 13: single-user notification (club applications/invites, approvals; also used by
// Phase 7's payment/check-in/arena notifications and Phase 11's catalog-proposal review
// outcomes). Reuses the same durable row + per-user pub/sub channel as the radius blast;
// email honors the same minor ceiling (no email to isMinor users, in-app always reaches them).
export async function notifyUser(
  userId: string,
  content: { title: string; message: string; link?: string },
): Promise<void> {
  const row = await prisma.notification.create({
    data: { userId, title: content.title, message: content.message, link: content.link ?? null },
  })
  await redis.publish(notifyChannel(userId), JSON.stringify(row))

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyEmail: true, isMinor: true, email: true },
  })
  if (user?.notifyEmail && !user.isMinor && user.email) {
    try {
      await sendNotificationEmail({
        to: user.email,
        subject: content.title,
        text: `${content.message}\n\nDetails: ${content.link ?? '/'}`,
      })
    } catch (err) {
      console.error(`[notify] email to ${userId} failed:`, err)
    }
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
    // notifyUser (above) already creates the row, publishes to Redis, AND sends the email
    // (same minor-ceiling rule) — do not duplicate the email send here.
    await notifyUser(user.id, content)
  }
}
