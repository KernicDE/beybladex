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
import { sendPushToUser } from '@/lib/webPush'

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

// Phase 18 — 'matchLifecycle' routes email/push through the SEPARATE granular toggles
// (notifyMatchLifecycle/notifyMatchLifecycleEmail) instead of the blanket notifyEmail, and is
// the ONLY category that fans out to Web Push at all — club/friend/proposal notifications
// ('default') keep exactly today's behavior (in-app + optional email via notifyEmail, no push):
// there is no granular push toggle for those categories yet (a deliberate, documented scope
// boundary for this phase, not an oversight — see the schema's own comment on
// notifyMatchLifecycle).
export type NotifyCategory = 'default' | 'matchLifecycle'

// Phase 13: single-user notification (club applications/invites, approvals; also used by
// Phase 7's payment/check-in/arena notifications and Phase 11's catalog-proposal review
// outcomes). Reuses the same durable row + per-user pub/sub channel as the radius blast;
// email honors the minor ceiling (no email to isMinor users, in-app always reaches them) for
// BOTH categories. Push does NOT carry the same ceiling (documented judgment call, Phase 18
// item 3): unlike email — sent unprompted to any address on file — a push subscription only
// exists after the user's own explicit OS permission grant + explicit subscribe action, and its
// content here is the same time-sensitive operational tournament info already reaching a minor
// in-app; the minor-protection concern behind the email ceiling (unsolicited third-party-relay
// contact) doesn't apply the same way to a device-local, opt-in-gated channel.
export async function notifyUser(
  userId: string,
  content: { title: string; message: string; link?: string },
  opts?: { category?: NotifyCategory },
): Promise<void> {
  const category = opts?.category ?? 'default'
  const row = await prisma.notification.create({
    data: { userId, title: content.title, message: content.message, link: content.link ?? null },
  })
  await redis.publish(notifyChannel(userId), JSON.stringify(row))

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyEmail: true, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: true, isMinor: true, email: true },
  })
  if (!user) return

  const emailEnabled = category === 'matchLifecycle' ? user.notifyMatchLifecycleEmail : user.notifyEmail
  if (emailEnabled && !user.isMinor && user.email) {
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

  if (category === 'matchLifecycle' && user.notifyMatchLifecycle) {
    try {
      await sendPushToUser(userId, { title: content.title, message: content.message, link: content.link })
    } catch (err) {
      console.error(`[notify] push to ${userId} failed:`, err)
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

// ---------------------------------------------------------------------------
// Phase 18 item 2 — match/arena lifecycle triggers. Each is a plain function call from the
// route that already causes the state change (no polling/cron mechanism, matching the
// codebase's standing "trigger on the write path" pattern from Phase 3/5's own notification and
// meta-recompute precedents). All three use category: 'matchLifecycle' (push fan-out + the
// separate granular email toggle, see notifyUser's own comment).

/** "Turnier gestartet" — fired from POST /api/tournaments/[id]/start to every checked-in,
 *  non-withdrawn participant. */
export async function notifyTournamentStarted(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { title: true } })
  if (!tournament) return
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, checkedIn: true, withdrawn: false },
    select: { userId: true },
  })
  await Promise.all(
    participants.map((p) =>
      notifyUser(
        p.userId,
        { title: 'Turnier gestartet', message: `„${tournament.title}“ hat begonnen.`, link: `/tournaments/${tournamentId}` },
        { category: 'matchLifecycle' }
      )
    )
  )
}

/** "Gehe zu Arena N" — fired from lib/arenaAssign.ts the moment a match receives a non-null
 *  arenaNumber (both the initial generation pass and the dynamic freed-arena pass), to both
 *  competing players (Phase 7 item 3's own precedent already notifies the assigned judge at
 *  this exact point — this is the same trigger point, extended to the players). */
export async function notifyArenaAssigned(matchId: string, arenaNumber: number): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { player1Id: true, player2Id: true, tournamentId: true },
  })
  if (!match) return
  const link = `/tournaments/${match.tournamentId}`
  const content = { title: `Gehe zu Arena ${arenaNumber}`, message: `Dein Match ist an Arena ${arenaNumber} dran.`, link }
  await Promise.all(
    [match.player1Id, match.player2Id]
      .filter((id): id is string => id !== null)
      .map((userId) => notifyUser(userId, content, { category: 'matchLifecycle' }))
  )
}

/** "Dein nächstes Match beginnt" — fired whenever a bracket/pairing write leaves a PENDING
 *  match with BOTH players resolved (round-1 generation, Round Robin fixtures, each Swiss
 *  round's pairing, and mid-bracket slot fills as earlier rounds complete) — to both players. */
export async function notifyMatchReady(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { status: true, player1Id: true, player2Id: true, tournamentId: true },
  })
  if (!match || match.status !== 'PENDING' || !match.player1Id || !match.player2Id) return
  const link = `/tournaments/${match.tournamentId}`
  const content = { title: 'Dein nächstes Match beginnt', message: 'Dein Gegner steht fest — bereite dich vor.', link }
  await Promise.all(
    [match.player1Id, match.player2Id].map((userId) => notifyUser(userId, content, { category: 'matchLifecycle' }))
  )
}
