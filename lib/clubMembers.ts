// lib/clubMembers.ts (Phase 13)
// The ONE place club membership reads live, so the status filter can never drift between
// the page and its regression test (tests/integration/club-member-status-filter.test.ts).
// BINDING RULE: every count/roster/authz read filters ClubMember to status ACTIVE — a
// PENDING_APPLICATION/PENDING_INVITE row must never inflate a member count, appear in a
// roster, or satisfy an isAdmin check. The ONLY reads that intentionally include pending
// rows are the viewer's own membership state (so the UI can show "Bewerbung ausstehend" /
// "Einladung annehmen") and the admin pending list (so admins can act on them).
import { prisma } from '@/lib/db'

// The user fields the club roster needs for resolveVisibleFields projection.
const ROSTER_USER_SELECT = {
  id: true, username: true, displayName: true, city: true, discordTag: true,
  bio: true, birthDate: true, isMinor: true, avatarImageId: true,
  profileVisibility: true, locationVisibility: true, collectionVisibility: true,
  decksVisibility: true, ageVisibility: true,
} as const

export async function getActiveRoster(clubId: string) {
  return prisma.clubMember.findMany({
    where: { clubId, status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: ROSTER_USER_SELECT } },
  })
}

export async function getViewerMembership(clubId: string, userId: string) {
  return prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { status: true, isAdmin: true },
  })
}

export async function getPendingMemberships(clubId: string) {
  return prisma.clubMember.findMany({
    where: { clubId, status: { in: ['PENDING_APPLICATION', 'PENDING_INVITE'] } },
    orderBy: { joinedAt: 'asc' },
    select: { id: true, userId: true, status: true, user: { select: { username: true, displayName: true } } },
  })
}

// The authz read: does this user hold real (ACTIVE) admin privileges in this club?
// Used by the tournament-creation gate; pending rows must never pass this check.
export async function getActiveAdminMembership(clubId: string, userId: string) {
  return prisma.clubMember.findFirst({
    where: { clubId, userId, status: 'ACTIVE', isAdmin: true },
    select: { id: true },
  })
}

// The caller's ACTIVE membership row (any ACTIVE member, admin or not) — the authz read the
// club action routes (invite/approve/promote/remove gates) use. A PENDING_APPLICATION /
// PENDING_INVITE row never appears here, so it can never confer privileges. Distinct from
// getViewerMembership, which intentionally includes pending rows for the UI's own-state view.
export async function getActiveMembership(clubId: string, userId: string) {
  return prisma.clubMember.findFirst({
    where: { clubId, userId, status: 'ACTIVE' },
    select: { isAdmin: true },
  })
}

// The ACTIVE admin user ids (the owner is NOT included — callers add ownerId themselves when
// they want the owner notified too, keeping ownership semantics at the call site).
export async function getActiveAdminUserIds(clubId: string): Promise<string[]> {
  const admins = await prisma.clubMember.findMany({
    where: { clubId, status: 'ACTIVE', isAdmin: true },
    select: { userId: true },
  })
  return admins.map((a) => a.userId)
}
