// app/api/clubs/[slug]/members/route.ts
// Club membership operations — Phase 4 (roles) + Phase 13 (join policies).
// AUTHZ RULES (standing Global-Constraints requirement):
// - POST self (join/apply): any authenticated user. Per Club.joinPolicy: OPEN creates an
//   ACTIVE row immediately (today's behavior); APPLICATION creates PENDING_APPLICATION
//   (an owner/admin approves via PATCH { action: 'approve' }); INVITE_ONLY rejects
//   self-service with 403 join_requires_invite.
// - POST other (invite): body { userId } — ONLY the club's OWNER or an ACTIVE isAdmin
//   member may invite someone else (403 negative test); creates a PENDING_INVITE row and
//   notifies the invitee. The invited user accepts via PATCH { action: 'accept' } (self
//   only → 403 for anyone else, mirroring Friendship's addressee rule) or declines via
//   DELETE (self only, removes the row).
// - PATCH promote/demote: body { userId, isAdmin } — only the club's OWNER or an ACTIVE
//   isAdmin member; anyone else gets 403 (negative test). The target must be a member (404).
//   The promote/demote toggle is status-agnostic BY DESIGN — the binding defense against a
//   pending row carrying privileges is that EVERY authz/count/roster read filters to
//   status ACTIVE (lib/clubMembers.ts, tests/integration/club-member-status-filter.test.ts).
// - DELETE: a member may always remove THEMSELVES (leave an ACTIVE row, decline a
//   PENDING_INVITE, retract a PENDING_APPLICATION); removing someone else requires
//   owner/ACTIVE-admin (403 negative test) and writes an AuditLog row (append-only, Phase 4).
// The caller's own privileges are always read via an ACTIVE-filtered lookup: a pending
// application/invite row never confers admin rights to its holder.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { notifyUser } from '@/lib/notify'

type Ctx = { params: Promise<{ slug: string }> }

async function loadClubAndCaller(clubSlug: string, userId: string) {
  const club = await prisma.club.findUnique({
    where: { slug: clubSlug },
    select: { id: true, ownerId: true, name: true, slug: true, joinPolicy: true },
  })
  if (!club) return null
  const caller = await prisma.clubMember.findFirst({
    where: { clubId: club.id, userId, status: 'ACTIVE' },
    select: { isAdmin: true },
  })
  return { club, caller }
}

async function parseBody(req: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  if (typeof body !== 'object' || body === null) return {}
  return body as Record<string, unknown>
}

// Notify the club's owner + ACTIVE admin members (deduplicated) — used when someone applies.
async function notifyClubAdmins(club: { id: string; ownerId: string; name: string; slug: string }, message: string) {
  const admins = await prisma.clubMember.findMany({
    where: { clubId: club.id, status: 'ACTIVE', isAdmin: true },
    select: { userId: true },
  })
  const recipients = new Set(admins.map((a) => a.userId))
  recipients.add(club.ownerId)
  for (const userId of recipients) {
    await notifyUser(userId, { title: `Neue Bewerbung: ${club.name}`, message, link: `/clubs/${club.slug}` })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadClubAndCaller(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  const { club, caller } = loaded

  const fields = await parseBody(req)
  if (fields instanceof Response) return fields
  const inviteeId = typeof fields.userId === 'string' && fields.userId.length > 0 ? fields.userId : null

  if (inviteeId && inviteeId !== userId) {
    // ---- INVITE path (Phase 13): only owner/ACTIVE-admin may create a membership for someone
    // else, as a PENDING_INVITE row. Rate-limited (invites are abuse-prone, standing rule).
    const isOwner = club.ownerId === userId
    if (!isOwner && !caller?.isAdmin) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    const { allowed } = await rateLimit(`clubs:invite:${userId}`, 20, 60 * 60)
    if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
    if (!(await prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true } }))) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }

    try {
      const membership = await prisma.clubMember.create({
        data: { clubId: club.id, userId: inviteeId, isAdmin: false, status: 'PENDING_INVITE' },
      })
      const inviter = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
      await notifyUser(inviteeId, {
        title: `Club-Einladung: ${club.name}`,
        message: `${inviter?.username ?? 'Ein:e Spieler:in'} lädt dich ein, dem Club beizutreten.`,
        link: `/clubs/${club.slug}`,
      })
      return Response.json({ id: membership.id, status: membership.status }, { status: 201 })
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
        return Response.json({ error: 'already_member' }, { status: 409 })
      }
      throw e
    }
  }

  // ---- SELF path: join or apply, per the club's join policy.
  const { allowed } = await rateLimit(`clubs:join:${userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  if (club.joinPolicy === 'INVITE_ONLY') {
    return Response.json({ error: 'join_requires_invite' }, { status: 403 })
  }
  const status = club.joinPolicy === 'APPLICATION' ? 'PENDING_APPLICATION' : 'ACTIVE'

  try {
    const membership = await prisma.clubMember.create({
      data: { clubId: club.id, userId, isAdmin: false, status },
    })
    if (status === 'PENDING_APPLICATION') {
      const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
      await notifyClubAdmins(club, `${applicant?.username ?? 'Jemand'} möchte dem Club beitreten.`)
    }
    return Response.json({ id: membership.id, isAdmin: membership.isAdmin, status: membership.status }, { status: 201 })
  } catch (e) {
    // P2002: the @@unique([clubId, userId]) constraint — already a member (any status).
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ error: 'already_member' }, { status: 409 })
    }
    throw e
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadClubAndCaller(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  const { club, caller } = loaded

  const fields = await parseBody(req)
  if (fields instanceof Response) return fields
  if (typeof fields.userId !== 'string' || fields.userId.length === 0) {
    return Response.json({ error: 'invalid_member' }, { status: 400 })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId: fields.userId } },
  })
  if (!target) return Response.json({ error: 'not_member' }, { status: 404 })

  const action = fields.action
  if (action !== undefined) {
    if (action === 'approve') {
      // APPLICATION approval: owner/ACTIVE-admin only (negative test); PENDING_APPLICATION → ACTIVE.
      const isOwner = club.ownerId === userId
      if (!isOwner && !caller?.isAdmin) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      if (target.status !== 'PENDING_APPLICATION') {
        return Response.json({ error: 'invalid_transition', status: target.status }, { status: 409 })
      }
      const updated = await prisma.clubMember.update({
        where: { id: target.id },
        data: { status: 'ACTIVE' },
      })
      await notifyUser(target.userId, {
        title: `Bewerbung angenommen: ${club.name}`,
        message: 'Du bist jetzt Mitglied des Clubs.',
        link: `/clubs/${club.slug}`,
      })
      return Response.json({ userId: updated.userId, status: updated.status }, { status: 200 })
    }
    if (action === 'accept') {
      // INVITE acceptance: ONLY the invited user, mirroring Friendship's addressee rule —
      // anyone else (including the inviting admin) gets 403 (negative test).
      if (target.userId !== userId) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      if (target.status !== 'PENDING_INVITE') {
        return Response.json({ error: 'invalid_transition', status: target.status }, { status: 409 })
      }
      const updated = await prisma.clubMember.update({
        where: { id: target.id },
        data: { status: 'ACTIVE' },
      })
      return Response.json({ userId: updated.userId, status: updated.status }, { status: 200 })
    }
    return Response.json({ error: 'invalid_action' }, { status: 400 })
  }

  // Promote/demote (Phase 4): owner/ACTIVE-admin only, membership alone is not enough.
  const isOwner = club.ownerId === userId
  if (!isOwner && !caller?.isAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (typeof fields.isAdmin !== 'boolean') {
    return Response.json({ error: 'invalid_member' }, { status: 400 })
  }

  const updated = await prisma.clubMember.update({
    where: { id: target.id },
    data: { isAdmin: fields.isAdmin },
  })
  return Response.json({ userId: updated.userId, isAdmin: updated.isAdmin, status: updated.status }, { status: 200 })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadClubAndCaller(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })

  const url = new URL(req.url)
  let targetUserId = url.searchParams.get('userId')
  if (!targetUserId) {
    const body = await parseBody(req)
    if (!(body instanceof Response) && typeof body.userId === 'string') {
      targetUserId = body.userId
    }
  }
  if (!targetUserId) return Response.json({ error: 'invalid_member' }, { status: 400 })

  const isSelf = targetUserId === userId
  const isOwner = loaded.club.ownerId === userId
  // Self-removal is always allowed (leave/decline/retract); removing someone else needs
  // owner/ACTIVE-admin. The caller's own privileges are ACTIVE-filtered in loadClubAndCaller.
  if (!isSelf && !isOwner && !loaded.caller?.isAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: loaded.club.id, userId: targetUserId } },
  })
  if (!target) return Response.json({ error: 'not_member' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.clubMember.delete({ where: { id: target.id } })
    // Audit trail for the privileged path only — a self-removal is not an admin action.
    if (!isSelf) {
      const [actor, kicked] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { username: true } }),
        tx.user.findUnique({ where: { id: targetUserId }, select: { username: true } }),
      ])
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'club.member_remove',
          targetType: 'club_member',
          targetId: target.id,
          summary: `${actor?.username ?? userId} hat ${kicked?.username ?? targetUserId} aus dem Club entfernt (Slug: ${slug})`,
        },
      })
    }
  })

  return new Response(null, { status: 204 })
}
