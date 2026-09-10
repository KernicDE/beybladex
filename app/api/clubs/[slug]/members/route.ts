// app/api/clubs/[slug]/members/route.ts
// Club membership operations — thin controller over lib/clubMembershipActions.ts (issue #57):
// auth → parse → call → map ClubMembershipError 1:1 onto the Response. The business logic
// (join policies, invite/approve/accept transitions, promote/demote, leave/remove with the
// append-only AuditLog row) lives in the lib module, unit-testable without HTTP; the authz
// rules are documented there. Membership READS are centralized in lib/clubMembers.ts (#61).
import { requireUser } from '@/lib/guards'
import { joinClub, inviteToClub, updateMembership, leaveClub, parseJsonObject, ClubMembershipError } from '@/lib/clubMembershipActions'

type Ctx = { params: Promise<{ slug: string }> }

function toResponse(e: ClubMembershipError): Response {
  return e.payload === null ? new Response(null, { status: e.status }) : Response.json(e.payload, { status: e.status })
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const userId = gate.userId

  const { slug } = await params
  const fields = await parseJsonObject(req)
  const inviteeId = typeof fields.userId === 'string' && fields.userId.length > 0 ? fields.userId : null

  try {
    // ---- INVITE path (Phase 13): inviting SOMEONE ELSE is owner/ACTIVE-admin only and lands
    // in inviteToClub; everything else is the self join/apply path.
    if (inviteeId && inviteeId !== userId) {
      const result = await inviteToClub(slug, userId, inviteeId)
      return Response.json(result.payload, { status: result.status })
    }
    const result = await joinClub(slug, userId)
    return Response.json(result.payload, { status: result.status })
  } catch (e) {
    if (e instanceof ClubMembershipError) return toResponse(e)
    throw e
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const userId = gate.userId

  const { slug } = await params
  const fields = await parseJsonObject(req)

  try {
    const result = await updateMembership(slug, userId, fields)
    return Response.json(result.payload, { status: result.status })
  } catch (e) {
    if (e instanceof ClubMembershipError) return toResponse(e)
    throw e
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const userId = gate.userId

  const { slug } = await params

  const url = new URL(req.url)
  let targetUserId = url.searchParams.get('userId')
  if (!targetUserId) {
    const body = await parseJsonObject(req)
    if (typeof body.userId === 'string') {
      targetUserId = body.userId
    }
  }
  if (!targetUserId) return Response.json({ error: 'invalid_member' }, { status: 400 })

  try {
    const result = await leaveClub(slug, userId, targetUserId)
    return result.payload === null ? new Response(null, { status: result.status }) : Response.json(result.payload, { status: result.status })
  } catch (e) {
    if (e instanceof ClubMembershipError) return toResponse(e)
    throw e
  }
}
