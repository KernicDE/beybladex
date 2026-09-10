// app/api/tournaments/[id]/participants/seed/route.ts (Phase 15)
// PATCH — set bracket seeds for this tournament's participants. AUTHZ RULE (standing
// Global-Constraints requirement): owner (createdById) or ADMIN only, same tier as every other
// OrganizerConsole action.
//
// Three methods, discriminated by body.method:
//   'manual'  — body.seeds: Record<userId, number | null>. Sets EXACTLY the given userIds to
//     EXACTLY the given values (null clears a seed back to auto). Every other participant's
//     seed is left untouched.
//   'rating'  — for every participant with NO manual seed currently set, assigns seeds in
//     current-season PlayerRating.elo descending order (unranked participants placed after
//     every rated one, in deterministic userId order — see lib/seeding.ts). Already-seeded
//     (manual) participants are never touched — "manual overrides always win" (binding rule).
//   'shuffle' — same manual-preserving behavior, but the unseeded subset gets a genuinely
//     randomized order (lib/seeding.ts's Fisher-Yates shuffle) instead of a rating sort.
//
// Only meaningful before the first stage's bracket is generated (seeding is read once, at
// generation time) — this route does NOT block after generation (harmless no-op then, matches
// the read-once semantics; no organizer-facing error needed for a state that simply has no
// further effect).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { assignSeedsToUnseeded, rankUnseededByRating, shuffleOrder } from '@/lib/seeding'

type Ctx = { params: Promise<{ id: string }> }

async function requireOrganizer(tournamentId: string, userId: string): Promise<Response | null> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (tournament.createdById !== userId && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] organizer seeding action; 60/min/user.
  const { allowed } = await rateLimit(`tournament:seed:${session.user.id}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const authzError = await requireOrganizer(id, session.user.id)
  if (authzError) return authzError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as Record<string, unknown>

  if (b.method === 'manual') {
    const seeds = b.seeds
    if (typeof seeds !== 'object' || seeds === null) return Response.json({ error: 'invalid_seeds' }, { status: 400 })
    const entries = Object.entries(seeds as Record<string, unknown>)
    for (const [, value] of entries) {
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
        return Response.json({ error: 'invalid_seed_value' }, { status: 400 })
      }
    }
    await prisma.$transaction(
      entries.map(([userId, value]) =>
        prisma.tournamentParticipant.updateMany({
          where: { tournamentId: id, userId },
          data: { seed: value as number | null },
        })
      )
    )
    const updated = await prisma.tournamentParticipant.findMany({ where: { tournamentId: id }, select: { userId: true, seed: true } })
    return Response.json({ participants: updated })
  }

  if (b.method === 'rating' || b.method === 'shuffle') {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: id, withdrawn: false },
      select: { userId: true, seed: true },
    })
    const unseeded = participants.filter((p) => p.seed === null).map((p) => p.userId)

    let order: string[]
    if (b.method === 'rating') {
      const season = await prisma.season.findFirst({ where: { status: 'ACTIVE' } })
      const ratings = season
        ? await prisma.playerRating.findMany({ where: { seasonId: season.id, userId: { in: unseeded } }, select: { userId: true, elo: true } })
        : []
      const eloByUserId = new Map(ratings.map((r) => [r.userId, r.elo]))
      order = rankUnseededByRating(unseeded, eloByUserId)
    } else {
      order = shuffleOrder(unseeded)
    }

    const assignments = assignSeedsToUnseeded(participants, order)
    if (assignments.size > 0) {
      await prisma.$transaction(
        [...assignments.entries()].map(([userId, seed]) =>
          prisma.tournamentParticipant.updateMany({ where: { tournamentId: id, userId }, data: { seed } })
        )
      )
    }
    const updated = await prisma.tournamentParticipant.findMany({ where: { tournamentId: id }, select: { userId: true, seed: true } })
    return Response.json({ participants: updated })
  }

  return Response.json({ error: 'invalid_method' }, { status: 400 })
}
