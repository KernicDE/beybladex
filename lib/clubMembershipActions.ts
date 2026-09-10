// lib/clubMembershipActions.ts (RC4, issue #57 — extracted from
// app/api/clubs/[slug]/members/route.ts; issue #61 — every membership READ centralized in
// lib/clubMembers.ts, the single source of truth for ACTIVE filtering)
// The club-membership BUSINESS LOGIC, HTTP-free and directly unit-testable: join/apply (per
// Club.joinPolicy), invite (owner/ACTIVE-admin only, PENDING_INVITE), approve/accept (status
// transitions), promote/demote, and leave/decline/retract/remove (with the append-only AuditLog
// row on the privileged path). The route handler is a thin controller: auth → parse → call →
// map ClubMembershipError onto the Response.
//
// ERROR CONTRACT: outcomes are thrown as ClubMembershipError with the EXACT status and payload
// the route previously returned (not_found 404, forbidden 403, rate_limited 429,
// already_member 409, invalid_transition 409, invalid_member/action 400, not_member 404) —
// the route catches and maps them 1:1, so integration tests see identical responses.
//
// AUTHZ RULES (standing Global-Constraints requirement, unchanged from the route):
// - POST self (join/apply): any authenticated user. Per Club.joinPolicy: OPEN creates an
//   ACTIVE row immediately; APPLICATION creates PENDING_APPLICATION (an owner/admin approves
//   via updateMembership { action: 'approve' }); INVITE_ONLY rejects self-service with 403
//   join_requires_invite.
// - POST other (invite): ONLY the club's OWNER or an ACTIVE isAdmin member may invite someone
//   else (403); creates a PENDING_INVITE row and notifies the invitee. The invited user accepts
//   via { action: 'accept' } (self only → 403, mirroring Friendship's addressee rule) or
//   declines via leaveClub (self only, removes the row).
// - approve/promote/demote: owner or ACTIVE isAdmin only (403). The promote/demote toggle is
//   status-agnostic BY DESIGN — the binding defense against a pending row carrying privileges
//   is that EVERY authz/count/roster read filters to status ACTIVE.
// - leaveClub: a member may always remove THEMSELVES; removing someone else requires
//   owner/ACTIVE-admin (403) and writes an AuditLog row (append-only, Phase 4).
// The caller's own privileges are always read via an ACTIVE-filtered lookup: a pending
// application/invite row never confers admin rights to its holder.
import { prisma } from '@/lib/db'
import { getActiveMembership, getActiveAdminUserIds } from '@/lib/clubMembers'
import { rateLimit } from '@/lib/rateLimit'
import { notifyUser } from '@/lib/notify'

export class ClubMembershipError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown> | null,
  ) {
    super(payload && typeof payload.error === 'string' ? (payload.error as string) : 'club_membership_failed')
  }
}

/** Lenient JSON-object reader (invalid/absent/non-object bodies → {}). HTTP shapes (arrays,
 *  strings) are not CollectionItem-style payloads here — the original route treated every
 *  unparseable body as "no fields". */
export async function parseJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  if (typeof body !== 'object' || body === null) return {}
  return body as Record<string, unknown>
}

async function loadClubAndCaller(clubSlug: string, userId: string) {
  const club = await prisma.club.findUnique({
    where: { slug: clubSlug },
    select: { id: true, ownerId: true, name: true, slug: true, joinPolicy: true },
  })
  if (!club) return null
  // ACTIVE-filtered authz read — lib/clubMembers.ts is the single source of truth for the
  // status filter; a pending application/invite row never confers admin rights (issue #61).
  const caller = await getActiveMembership(club.id, userId)
  return { club, caller }
}

// Notify the club's owner + ACTIVE admin members (deduplicated) — used when someone applies.
async function notifyClubAdmins(club: { id: string; ownerId: string; name: string; slug: string }, message: string) {
  const recipients = new Set(await getActiveAdminUserIds(club.id))
  recipients.add(club.ownerId)
  for (const userId of recipients) {
    await notifyUser(userId, { title: `Neue Bewerbung: ${club.name}`, message, link: `/clubs/${club.slug}` })
  }
}

function p200(payload: Record<string, unknown>) {
  return { status: 200, payload }
}

/** POST self path: join (OPEN) or apply (APPLICATION) per the club's join policy. */
export async function joinClub(clubSlug: string, userId: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const loaded = await loadClubAndCaller(clubSlug, userId)
  if (!loaded) throw new ClubMembershipError(404, { error: 'not_found' })
  const { club } = loaded

  const { allowed } = await rateLimit(`clubs:join:${userId}`, 30, 60)
  if (!allowed) throw new ClubMembershipError(429, { error: 'rate_limited' })

  if (club.joinPolicy === 'INVITE_ONLY') {
    throw new ClubMembershipError(403, { error: 'join_requires_invite' })
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
    return { status: 201, payload: { id: membership.id, isAdmin: membership.isAdmin, status: membership.status } }
  } catch (e) {
    // P2002: the @@unique([clubId, userId]) constraint — already a member (any status).
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      throw new ClubMembershipError(409, { error: 'already_member' })
    }
    throw e
  }
}

/** POST invite path: owner/ACTIVE-admin creates a PENDING_INVITE row for someone else. */
export async function inviteToClub(
  clubSlug: string,
  userId: string,
  inviteeId: string,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const loaded = await loadClubAndCaller(clubSlug, userId)
  if (!loaded) throw new ClubMembershipError(404, { error: 'not_found' })
  const { club, caller } = loaded

  const isOwner = club.ownerId === userId
  if (!isOwner && !caller?.isAdmin) {
    throw new ClubMembershipError(403, { error: 'forbidden' })
  }
  const { allowed } = await rateLimit(`clubs:invite:${userId}`, 20, 60 * 60)
  if (!allowed) throw new ClubMembershipError(429, { error: 'rate_limited' })
  if (!(await prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true } }))) {
    throw new ClubMembershipError(404, { error: 'not_found' })
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
    return { status: 201, payload: { id: membership.id, status: membership.status } }
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      throw new ClubMembershipError(409, { error: 'already_member' })
    }
    throw e
  }
}

/** PATCH: approve an application, accept an invite, or promote/demote a member. */
export async function updateMembership(
  clubSlug: string,
  userId: string,
  fields: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const loaded = await loadClubAndCaller(clubSlug, userId)
  if (!loaded) throw new ClubMembershipError(404, { error: 'not_found' })
  const { club, caller } = loaded

  if (typeof fields.userId !== 'string' || fields.userId.length === 0) {
    throw new ClubMembershipError(400, { error: 'invalid_member' })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId: fields.userId } },
  })
  if (!target) throw new ClubMembershipError(404, { error: 'not_member' })

  const action = fields.action
  if (action !== undefined) {
    if (action === 'approve') {
      // APPLICATION approval: owner/ACTIVE-admin only (negative test); PENDING_APPLICATION → ACTIVE.
      const isOwner = club.ownerId === userId
      if (!isOwner && !caller?.isAdmin) {
        throw new ClubMembershipError(403, { error: 'forbidden' })
      }
      if (target.status !== 'PENDING_APPLICATION') {
        throw new ClubMembershipError(409, { error: 'invalid_transition', status: target.status })
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
      return p200({ userId: updated.userId, status: updated.status })
    }
    if (action === 'accept') {
      // INVITE acceptance: ONLY the invited user, mirroring Friendship's addressee rule —
      // anyone else (including the inviting admin) gets 403 (negative test).
      if (target.userId !== userId) {
        throw new ClubMembershipError(403, { error: 'forbidden' })
      }
      if (target.status !== 'PENDING_INVITE') {
        throw new ClubMembershipError(409, { error: 'invalid_transition', status: target.status })
      }
      const updated = await prisma.clubMember.update({
        where: { id: target.id },
        data: { status: 'ACTIVE' },
      })
      return p200({ userId: updated.userId, status: updated.status })
    }
    throw new ClubMembershipError(400, { error: 'invalid_action' })
  }

  // Promote/demote (Phase 4): owner/ACTIVE-admin only, membership alone is not enough.
  const isOwner = club.ownerId === userId
  if (!isOwner && !caller?.isAdmin) {
    throw new ClubMembershipError(403, { error: 'forbidden' })
  }
  if (typeof fields.isAdmin !== 'boolean') {
    throw new ClubMembershipError(400, { error: 'invalid_member' })
  }

  const updated = await prisma.clubMember.update({
    where: { id: target.id },
    data: { isAdmin: fields.isAdmin },
  })
  return p200({ userId: updated.userId, isAdmin: updated.isAdmin, status: updated.status })
}

/** DELETE: self-removal (leave an ACTIVE row, decline a PENDING_INVITE, retract a
 *  PENDING_APPLICATION) is always allowed; removing someone else needs owner/ACTIVE-admin and
 *  writes an AuditLog row (append-only, Phase 4). Returns the 204 shape (payload null). */
export async function leaveClub(clubSlug: string, userId: string, targetUserId: string): Promise<{ status: number; payload: null }> {
  const loaded = await loadClubAndCaller(clubSlug, userId)
  if (!loaded) throw new ClubMembershipError(404, { error: 'not_found' })

  const isSelf = targetUserId === userId
  const isOwner = loaded.club.ownerId === userId
  // Self-removal is always allowed (leave/decline/retract); removing someone else needs
  // owner/ACTIVE-admin. The caller's own privileges are ACTIVE-filtered in loadClubAndCaller.
  if (!isSelf && !isOwner && !loaded.caller?.isAdmin) {
    throw new ClubMembershipError(403, { error: 'forbidden' })
  }

  const target = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: loaded.club.id, userId: targetUserId } },
  })
  if (!target) throw new ClubMembershipError(404, { error: 'not_member' })

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
          summary: `${actor?.username ?? userId} hat ${kicked?.username ?? targetUserId} aus dem Club entfernt (Slug: ${clubSlug})`,
        },
      })
    }
  })

  return { status: 204, payload: null }
}
