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
//
// [RC5 #44] Radius-blast performance contract:
// - The geographic prefilter is a SQL bounding box (users outside the largest possible radius
//   can never be in range, so the DB never ships them), the per-user radius check stays the
//   exact JS haversine.
// - The fan-out runs with bounded concurrency instead of one sequential await per user.
// - Email and push sends are wrapped in an explicit timeout — an unresponsive SMTP/WebPush
//   endpoint must not stall the blast (and, being fire-and-forget from the create route, the
//   response either — see app/api/tournaments/route.ts).
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

// [RC5 #44] The blast only needs these fields — the caller (POST /api/tournaments) selects
// exactly this set instead of shipping the full tournament row.
export type RadiusBlastTarget = Pick<
  Tournament,
  'id' | 'title' | 'locationName' | 'city' | 'postalCode' | 'startDate' | 'latitude' | 'longitude' | 'isRecurring' | 'createdById'
>

// [RC5 #44] notifyRadiusKm is validated to 1..500 km at the settings route
// (NOTIFY_RADIUS_MAX_KM) — bounding the prefilter box by that max is sound: anyone outside the
// box has a distance > 500 km ≥ their own radius and can never be notified.
const MAX_NOTIFY_RADIUS_KM = 500
const KM_PER_LAT_DEG = 111.32

/** Latitude/longitude box around a point at the given radius — pure SQL-prefilter geometry. */
export function boundingBoxForRadius(lat: number, lng: number, radiusKm: number) {
  return {
    latMin: lat - radiusKm / KM_PER_LAT_DEG,
    latMax: lat + radiusKm / KM_PER_LAT_DEG,
    lngMin: lng - radiusKm / (KM_PER_LAT_DEG * Math.cos((lat * Math.PI) / 180)),
    lngMax: lng + radiusKm / (KM_PER_LAT_DEG * Math.cos((lat * Math.PI) / 180)),
  }
}

// [RC5 #44] bounded fan-out: at most `limit` notifyUser calls in flight. Sequential awaited
// one-at-a-time delivery made the blast O(n) in SMTP/server round-trips; an unbounded
// Promise.all would spike DB/email connections for large local user bases. A rejected item
// is logged and skipped — one failing recipient must not starve the rest.
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (err) {
        console.error('[notify] fan-out item failed:', err)
      }
    }
  })
  await Promise.all(workers)
}

// [RC5 #44] Explicit ceiling on the SMTP/WebPush round-trips: an unresponsive mail server or
// push endpoint must not stall a notification (or, transitively, the blast that awaits it).
// The underlying promise keeps running but is no longer awaited; its own catch/log handling is
// unchanged.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The losing side of the race must never surface as an unhandledRejection: if the timeout
  // wins, the still-in-flight delivery promise rejects later with no one awaiting it.
  promise.catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`delivery timeout after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const DELIVERY_TIMEOUT_MS = 10_000

function notificationContent(t: RadiusBlastTarget): { title: string; message: string; link: string } {
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
// item 3, revised after review). The decision rests on CONSENT POSTURE, not on where delivery
// physically transits — Web Push notifications DO pass through the browser vendor's own push
// service (Mozilla/Google/Apple), so "device-local" is not the load-bearing argument here (an
// earlier version of this comment leaned on it; lib/webPush.ts's own header comment correctly
// says so). The actual reason: unlike email — sent unprompted to any address already on file —
// a push subscription can only come into existence after the user's own DELIBERATE subscribe
// action on the settings page PLUS an OS-level permission grant on their own device; nothing
// about a User row alone can cause a push send the way `notifyEmail: true` + a stored address
// can cause an email send. That dual opt-in is a materially different consent posture than
// email-to-address-on-file, and the content is identical to what an in-app row (always on,
// reaching a minor regardless) already shows — push only adds OS-level salience, not new
// information. `notifyMatchLifecycle` defaults to `true`, so this is a real, deliberate
// decision about minors, not an oversight: if a stricter posture is ever wanted, the
// conservative compromise is defaulting push (not the in-app row) to off for `isMinor` users,
// which would be a small, isolated change here — not implemented, since the opt-in argument
// above was judged sufficient at implementation time.
export async function notifyUser(
  userId: string,
  content: { title: string; message: string; link?: string },
  opts?: { category?: NotifyCategory },
): Promise<void> {
  const category = opts?.category ?? 'default'
  const row = await prisma.notification.create({
    data: { userId, title: content.title, message: content.message, link: content.link ?? null },
  })
  // [RC3 #51] The Redis publish only feeds the live SSE/pub-sub stream. The durable row above is
  // the source of truth: the inbox read path serves it regardless, so a failing publish must not
  // abort the caller (radius blast, admin proposal review, match lifecycle) nor turn a committed
  // action into a 500. Log and continue, exactly like the email/push sends below.
  try {
    await redis.publish(notifyChannel(userId), JSON.stringify(row))
  } catch (err) {
    console.error(`[notify] redis publish for ${userId} failed:`, err)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyEmail: true, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: true, isMinor: true, email: true },
  })
  if (!user) return

  const emailEnabled = category === 'matchLifecycle' ? user.notifyMatchLifecycleEmail : user.notifyEmail
  if (emailEnabled && !user.isMinor && user.email) {
    try {
      // [RC5 #44] explicit delivery timeout — a hanging SMTP session must not stall the caller.
      await withTimeout(
        sendNotificationEmail({
          to: user.email,
          subject: content.title,
          text: `${content.message}\n\nDetails: ${content.link ?? '/'}`,
        }),
        DELIVERY_TIMEOUT_MS,
      )
    } catch (err) {
      console.error(`[notify] email to ${userId} failed:`, err)
    }
  }

  if (category === 'matchLifecycle' && user.notifyMatchLifecycle) {
    try {
      await withTimeout(
        sendPushToUser(userId, { title: content.title, message: content.message, link: content.link }),
        DELIVERY_TIMEOUT_MS,
      )
    } catch (err) {
      console.error(`[notify] push to ${userId} failed:`, err)
    }
  }
}

// [RC5 #44] at most this many deliveries (DB row + Redis publish + email/push) in flight at
// once during a radius blast — enough to overlap SMTP/Redis latency, small enough to keep DB
// and connection pools flat.
const FANOUT_CONCURRENCY = 8

export async function notifyUsersInRadius(tournament: RadiusBlastTarget): Promise<void> {
  const box = boundingBoxForRadius(tournament.latitude, tournament.longitude, MAX_NOTIFY_RADIUS_KM)
  const candidates = await prisma.user.findMany({
    where: {
      // The organizer is not a candidate for their own tournament's radius blast.
      id: { not: tournament.createdById },
      latitude: { not: null, gte: box.latMin, lte: box.latMax },
      longitude: { not: null, gte: box.lngMin, lte: box.lngMax },
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
  // [RC5 #44] bounded-concurrency fan-out (was: one sequential await per user inside the
  // create-request). notifyUser (above) already creates the row, publishes to Redis, AND sends
  // the email (same minor-ceiling rule) — do not duplicate the email send here.
  await mapWithConcurrency(eligible, FANOUT_CONCURRENCY, (user) => notifyUser(user.id, content))
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

/** "Dein nächstes Match beginnt" (+ "Gehe zu Arena N" if applicable) — the combined post-write
 *  check every bracket/pairing/slot-fill call site runs after touching a match. Fires "Dein
 *  nächstes Match beginnt" whenever this read finds a PENDING match with BOTH players resolved
 *  (round-1 generation, Round Robin fixtures, each Swiss round's pairing, mid-bracket slot fills
 *  as earlier rounds complete, no-show auto-advances, and grand-final reset population).
 *
 *  [REVIEW-FIX P18-1] ALSO fires "Gehe zu Arena N" here, in the SAME read, when the match
 *  already carries a non-null arenaNumber — closing a real gap the Phase 18 review found:
 *  lib/arenaAssign.ts's generation-time pass (assignArenasAtGeneration) can assign an arena to
 *  a match that has NO PLAYERS yet (later elimination rounds), so notifyArenaAssigned's own
 *  null-player filter silently drops it and no later write ever re-fires it — only the DYNAMIC
 *  pass (assignFreedArena, which only touches unassigned matches) re-notifies. This read is the
 *  first point where "this match now has both players AND an arena" can be observed together,
 *  so it's the natural place to catch that combination. Call sites that assign an arena directly
 *  (lib/arenaAssign.ts itself) still call notifyArenaAssigned separately for the normal case
 *  (arena assigned to an already-both-players match) — this is strictly the catch-up path.
 *
 *  KNOWN, ACCEPTED RACE (Phase 18 review, not fixed): two matches whose winners feed the SAME
 *  next match, scored concurrently, can each independently re-read the parent match as "both
 *  slots now filled" and both call this function — a rare double notification, never a
 *  correctness issue (no double-counted score, no duplicate DB state beyond an extra
 *  Notification row). No transition token/transaction guards this; low probability (requires
 *  two adjacent matches completing at the same instant), low impact, so left undone rather than
 *  adding transactional complexity for a cosmetic duplicate push. */
export async function notifyMatchReady(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { status: true, player1Id: true, player2Id: true, tournamentId: true, arenaNumber: true },
  })
  if (!match || match.status !== 'PENDING' || !match.player1Id || !match.player2Id) return
  const link = `/tournaments/${match.tournamentId}`
  const players = [match.player1Id, match.player2Id]
  const readyContent = { title: 'Dein nächstes Match beginnt', message: 'Dein Gegner steht fest — bereite dich vor.', link }
  await Promise.all(players.map((userId) => notifyUser(userId, readyContent, { category: 'matchLifecycle' })))

  if (match.arenaNumber !== null) {
    const arenaContent = { title: `Gehe zu Arena ${match.arenaNumber}`, message: `Dein Match ist an Arena ${match.arenaNumber} dran.`, link }
    await Promise.all(players.map((userId) => notifyUser(userId, arenaContent, { category: 'matchLifecycle' })))
  }
}
