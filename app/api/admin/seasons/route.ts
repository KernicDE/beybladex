// app/api/admin/seasons/route.ts (Phase 14)
// GET  — list all Seasons (ADMIN only), newest first.
// POST — create a new Season. ADMIN-only (a season boundary rewrites every player's rating —
//   higher-stakes than catalog curation, so this is NOT opened to the TRUSTED/JUDGE/ORGANIZER
//   tier the way Phase 11's proposal review was).
//
// BINDING LIFECYCLE RULE (master plan Phase 14 §3): only one Season may be ACTIVE at a time.
// Creating a new one REQUIRES the current ACTIVE season (if any) to already be COMPLETED —
// enforced here at the application level (see the schema's own comment on why this isn't a DB
// constraint). The request body may optionally include `completePreviousSeasonId` to complete
// the current active season and create the new one as one atomic action (the common real
// workflow: "end this season, start the next"), or the caller may PATCH-complete it separately
// first — either order works, but a second concurrent ACTIVE season is always rejected.
//
// SEASON ROLLOVER, regression-to-mean (binding decision, master plan Phase 14 §3): when a new
// Season is created, every player who was RATED in the just-completed previous season (if any)
// is seeded into the new season at round(oldElo * 0.75 + 1000 * 0.25) — lib/elo.ts's
// regressToMean — as a one-time seed step, not a hard reset and not a full carry-over. This is
// an admin action, not an automatic cron (this repo's standing no-scheduler-infra constraint).
// A season boundary never touches Match rows or the previous (now-frozen) season's PlayerRating
// rows — those remain the permanent historical record for that season.
import { requireAdmin } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { regressToMean } from '@/lib/elo'

export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const seasons = await prisma.season.findMany({ orderBy: { startsAt: 'desc' } })
  return Response.json({ seasons })
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const startsAt = typeof b.startsAt === 'string' ? new Date(b.startsAt) : null
  const endsAt = typeof b.endsAt === 'string' ? new Date(b.endsAt) : null
  if (name.length === 0 || name.length > 100) return Response.json({ error: 'invalid_name' }, { status: 400 })
  if (!startsAt || Number.isNaN(startsAt.getTime()) || !endsAt || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return Response.json({ error: 'invalid_dates' }, { status: 400 })
  }
  const completePreviousSeasonId =
    typeof b.completePreviousSeasonId === 'string' && b.completePreviousSeasonId.length > 0
      ? b.completePreviousSeasonId
      : null

  const existingActive = await prisma.season.findFirst({ where: { status: 'ACTIVE' } })
  if (existingActive && existingActive.id !== completePreviousSeasonId) {
    return Response.json(
      { error: 'active_season_exists', activeSeasonId: existingActive.id },
      { status: 409 }
    )
  }

  const created = await prisma.$transaction(async (tx) => {
    if (existingActive) {
      await tx.season.update({ where: { id: existingActive.id }, data: { status: 'COMPLETED' } })
    }
    const season = await tx.season.create({ data: { name, startsAt, endsAt, status: 'ACTIVE' } })

    // Seed regressed ratings for every player who was rated in the just-completed season.
    if (existingActive) {
      const priorRatings = await tx.playerRating.findMany({
        where: { seasonId: existingActive.id },
        select: { userId: true, elo: true },
      })
      if (priorRatings.length > 0) {
        await tx.playerRating.createMany({
          data: priorRatings.map((r) => {
            const seeded = regressToMean(r.elo)
            return { seasonId: season.id, userId: r.userId, elo: seeded, peakElo: seeded, gamesPlayed: 0 }
          }),
        })
      }
    }
    return season
  })

  return Response.json(created, { status: 201 })
}
