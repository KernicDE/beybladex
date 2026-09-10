// app/api/clubs/[slug]/route.ts (Phase 13)
// PATCH — edit a club's profile fields (description, websiteUrl, discordUrl, joinPolicy).
// AUTHZ RULE (standing Global-Constraints requirement): only the club's OWNER or an ACTIVE
// isAdmin member may edit; anyone else gets 403 (negative test in
// tests/integration/club-join-policies.test.ts). Name/slug/owner are immutable here —
// ownership transfer is out of scope (same as Phase 4). URL validation is length-cap only,
// no format allowlist (see app/api/clubs/route.ts); joinPolicy must be a valid enum value.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getActiveAdminMembership } from '@/lib/clubMembers'

const DESCRIPTION_MAX = 1000
const URL_MAX = 200
const JOIN_POLICIES = ['OPEN', 'APPLICATION', 'INVITE_ONLY'] as const

function parseOptionalUrl(value: unknown): { ok: boolean; value: string | null } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > URL_MAX) return { ok: false, value: null }
  return { ok: true, value: value.trim() || null }
}

type Ctx = { params: Promise<{ slug: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
  if (!club) return Response.json({ error: 'not_found' }, { status: 404 })

  // Owner OR an ACTIVE admin membership — a pending row never confers edit rights.
  if (club.ownerId !== userId && !(await getActiveAdminMembership(club.id, userId))) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const fields = body as Record<string, unknown>

  const data: Record<string, unknown> = {}
  if (fields.description !== undefined) {
    if (fields.description !== null && (typeof fields.description !== 'string' || fields.description.length > DESCRIPTION_MAX)) {
      return Response.json({ error: 'invalid_description' }, { status: 400 })
    }
    data.description = typeof fields.description === 'string' ? fields.description.trim() || null : null
  }
  for (const key of ['websiteUrl', 'discordUrl'] as const) {
    if (fields[key] !== undefined) {
      const parsed = parseOptionalUrl(fields[key])
      if (!parsed.ok) return Response.json({ error: 'invalid_club_url' }, { status: 400 })
      data[key] = parsed.value
    }
  }
  if (fields.joinPolicy !== undefined) {
    if (typeof fields.joinPolicy !== 'string' || !(JOIN_POLICIES as readonly string[]).includes(fields.joinPolicy)) {
      return Response.json({ error: 'invalid_join_policy' }, { status: 400 })
    }
    data.joinPolicy = fields.joinPolicy
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'no_fields' }, { status: 400 })
  }

  const updated = await prisma.club.update({ where: { id: club.id }, data })
  return Response.json(
    { id: updated.id, slug: updated.slug, description: updated.description, websiteUrl: updated.websiteUrl, discordUrl: updated.discordUrl, joinPolicy: updated.joinPolicy },
    { status: 200 },
  )
}
