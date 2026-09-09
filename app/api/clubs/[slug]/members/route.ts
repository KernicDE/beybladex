// app/api/clubs/[slug]/members/route.ts
// Club membership operations. AUTHZ RULES (standing Global-Constraints requirement):
// - POST (join): any authenticated user; creates an isAdmin:false ClubMember row. The
//   @@unique([clubId, userId]) constraint turns a duplicate join into a 409 (constraint proof
//   in tests/integration/club-roles.test.ts).
// - PATCH (promote/demote): body { userId, isAdmin } — only the club's OWNER or an existing
//   isAdmin member; anyone else gets 403 (negative test). The target must be a member (404).
// - DELETE (leave/kick): a member may always remove THEMSELVES; removing someone else
//   requires owner/isAdmin — a non-admin removing another user is 403 (negative test). An
//   admin-initiated kick (caller ≠ target) writes an AuditLog row (append-only, Phase 4).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ slug: string }> }

async function loadClubAndCaller(clubSlug: string, userId: string) {
  const club = await prisma.club.findUnique({ where: { slug: clubSlug }, select: { id: true, ownerId: true } })
  if (!club) return null
  const caller = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId } },
    select: { isAdmin: true },
  })
  return { club, caller }
}

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { slug } = await params
  const loaded = await loadClubAndCaller(slug, session.user.id)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })

  try {
    const membership = await prisma.clubMember.create({
      data: { clubId: loaded.club.id, userId: session.user.id, isAdmin: false },
    })
    return Response.json({ id: membership.id, isAdmin: membership.isAdmin }, { status: 201 })
  } catch (e) {
    // P2002: the @@unique([clubId, userId]) constraint — already a member.
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ error: 'already_member' }, { status: 409 })
    }
    throw e
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { slug } = await params
  const loaded = await loadClubAndCaller(slug, session.user.id)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })

  // Only the owner or an existing admin member may promote/demote — membership alone is not enough.
  const isOwner = loaded.club.ownerId === session.user.id
  if (!isOwner && !loaded.caller?.isAdmin) {
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
  if (typeof fields.userId !== 'string' || fields.userId.length === 0 || typeof fields.isAdmin !== 'boolean') {
    return Response.json({ error: 'invalid_member' }, { status: 400 })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: loaded.club.id, userId: fields.userId } },
  })
  if (!target) return Response.json({ error: 'not_member' }, { status: 404 })

  const updated = await prisma.clubMember.update({
    where: { id: target.id },
    data: { isAdmin: fields.isAdmin },
  })
  return Response.json({ userId: updated.userId, isAdmin: updated.isAdmin }, { status: 200 })
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
    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = null
    }
    if (typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).userId === 'string') {
      targetUserId = (body as Record<string, unknown>).userId as string
    }
  }
  if (!targetUserId) return Response.json({ error: 'invalid_member' }, { status: 400 })

  const isSelf = targetUserId === userId
  const isOwner = loaded.club.ownerId === userId
  // Self-removal (leave) is always allowed; kicking someone else needs owner/isAdmin.
  if (!isSelf && !isOwner && !loaded.caller?.isAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: loaded.club.id, userId: targetUserId } },
  })
  if (!target) return Response.json({ error: 'not_member' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.clubMember.delete({ where: { id: target.id } })
    // Audit trail for the privileged path only — a self-leave is not an admin action.
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
