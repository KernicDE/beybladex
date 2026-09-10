// app/api/tournaments/[id]/stages/route.ts
// Phase 5 Part C2 — stage management from the organizer console.
// AUTHZ RULE (standing Global-Constraints requirement; negative test in
// tests/integration/stage-authz.test.ts): only the tournament's creator (createdById) or a user
// with the ADMIN role may CREATE a stage; anyone else gets 403.
//   POST — body { name, format, order?, swissRounds?, roundRobinRepeats?, qualifyCount?,
//     arenaCount? }: creates a TournamentStage. `order` defaults to the next 1-based sequence
//     slot; SWISS requires swissRounds ≥ 1; ROUND_ROBIN accepts optional roundRobinRepeats
//     (1, 2, or 3 — anything else is a 400). Phase 7: optional arenaCount (integer 1..64, other
//     values ignored) persists on the TOURNAMENT (one arena pool per venue) — the generate route
//     uses it when handing out Match.arenaNumber after creating the stage's matches.
//   GET  — lists the tournament's stages, ordered. Deliberately unbounded: a tournament has a
//     handful of stages by design (standing pagination rule's documented small-collection case).
//     Live tournament surface → force-dynamic ([REVIEW-FIX: performance P16]).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseArenaCount } from '@/lib/arenaAssign'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const FORMATS = new Set(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN'])

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const format = typeof body.format === 'string' ? body.format : ''
  if (name.length === 0 || name.length > 80 || !FORMATS.has(format)) {
    return Response.json({ error: 'invalid_stage' }, { status: 400 })
  }
  const swissRounds = typeof body.swissRounds === 'number' && Number.isInteger(body.swissRounds) ? body.swissRounds : null
  if (format === 'SWISS' && (swissRounds === null || swissRounds < 1)) {
    return Response.json({ error: 'invalid_swiss_rounds' }, { status: 400 })
  }
  // Phase 5 Part C3 — optional for ROUND_ROBIN (null/omitted defaults to 1 at the generate route);
  // rejected unless 1, 2, or 3 whenever present.
  const roundRobinRepeats =
    typeof body.roundRobinRepeats === 'number' && Number.isInteger(body.roundRobinRepeats) ? body.roundRobinRepeats : null
  if (roundRobinRepeats !== null && ![1, 2, 3].includes(roundRobinRepeats)) {
    return Response.json({ error: 'invalid_round_robin_repeats' }, { status: 400 })
  }
  const qualifyCount =
    typeof body.qualifyCount === 'number' && Number.isInteger(body.qualifyCount) && body.qualifyCount >= 1
      ? body.qualifyCount
      : null

  const last = await prisma.tournamentStage.findFirst({ where: { tournamentId: id }, orderBy: { order: 'desc' } })
  const order = typeof body.order === 'number' && Number.isInteger(body.order) && body.order >= 1 ? body.order : (last?.order ?? 0) + 1
  const clash = await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId: id, order } } })
  if (clash) return Response.json({ error: 'order_exists' }, { status: 409 })

  const stage = await prisma.tournamentStage.create({
    data: {
      tournamentId: id, order, name,
      format: format as 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN',
      swissRounds, roundRobinRepeats, qualifyCount,
    },
  })
  // Phase 7 — optional arena pool size for the venue (tournament-scoped, see header comment).
  const arenaCount = parseArenaCount(body.arenaCount)
  if (arenaCount !== null) {
    await prisma.tournament.update({ where: { id }, data: { arenaCount } })
  }
  return Response.json({ id: stage.id, order: stage.order }, { status: 201 })
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const stages = await prisma.tournamentStage.findMany({
    where: { tournamentId: id },
    orderBy: { order: 'asc' },
    include: { _count: { select: { matches: true } } },
  })
  return Response.json({ stages })
}
