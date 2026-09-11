// app/api/teams/route.ts (RC15, issue #12 — MVP3 3-vs-3 team competition)
// Team creation. AUTHZ RULE: any authenticated user may create a team and becomes its
// CAPTAIN (TeamMember row in the SAME transaction — a team without a captain could never be
// managed or registered). body.clubId is optional; when set, the caller must be an ACTIVE
// member of that club or an ADMIN (a team claims club affiliation — the club must actually
// know the caller), matching the master-plan sketch's nullable clubId.
import { requireUser } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { slugify, uniqueSlug } from '@/lib/slug'
import { validateTeamName } from '@/lib/teams'
import { getActiveMembership } from '@/lib/clubMembers'

export async function POST(req: Request) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  // [REVIEW-FIX: backend-security #37 convention] team setup churn; 30/min/user.
  const { allowed } = await rateLimit(`teams:create:${gate.userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const nameCheck = validateTeamName(body.name)
  if (!nameCheck.ok) return Response.json({ error: nameCheck.error }, { status: 400 })

  const clubId = typeof body.clubId === 'string' && body.clubId.length > 0 ? body.clubId : null
  if (clubId) {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } })
    if (!club) return Response.json({ error: 'club_not_found' }, { status: 404 })
    const caller = await prisma.user.findUnique({ where: { id: gate.userId }, select: { role: true } })
    if (caller?.role !== 'ADMIN' && !(await getActiveMembership(clubId, gate.userId))) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const slug = await uniqueSlug(slugify(nameCheck.name), async (s) => (await prisma.team.findUnique({ where: { slug: s }, select: { id: true } })) !== null)
  const team = await prisma.team.create({
    data: {
      name: nameCheck.name,
      slug,
      clubId,
      createdById: gate.userId,
      // The creator IS the first roster member, as captain — same transaction, no captainless team.
      members: { create: { userId: gate.userId, role: 'CAPTAIN' } },
    },
    select: { id: true, slug: true },
  })
  return Response.json(team, { status: 201 })
}
