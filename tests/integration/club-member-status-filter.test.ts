// tests/integration/club-member-status-filter.test.ts
// Phase 13's single most important correctness requirement, called out explicitly in the
// plan: a PENDING_APPLICATION/PENDING_INVITE ClubMember row must NEVER inflate a member
// count, appear in the active roster, or pass an isAdmin authz check — even if the row was
// mistakenly created with isAdmin: true (e.g. a buggy invite path). Integration — CI-only.
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { getActiveRoster, getActiveAdminMembership } from '@/lib/clubMembers'
import { GET as GET_CLUBS } from '@/app/api/clubs/route'

async function seedUser(suffix: string, prefix: string) {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role: 'USER' } })
}

describe('club member status filter (regression guard)', () => {
  it('a PENDING_APPLICATION row with isAdmin:true does not count, does not appear in the roster, and does not pass the ACTIVE admin authz check', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'csfown')
    const active = await seedUser(suffix, 'csfact')
    const pendingApp = await seedUser(suffix, 'csfapp')
    const pendingInvite = await seedUser(suffix, 'csfinv')

    const club = await prisma.club.create({
      data: {
        name: `Status Filter Club ${suffix}`,
        slug: `status-filter-club-${suffix}`,
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, isAdmin: true, status: 'ACTIVE' },
            { userId: active.id, isAdmin: false, status: 'ACTIVE' },
            // Deliberately isAdmin:true on both pending rows — the acceptance-critical case:
            // even a mistakenly-privileged pending row must confer nothing while pending.
            { userId: pendingApp.id, isAdmin: true, status: 'PENDING_APPLICATION' },
            { userId: pendingInvite.id, isAdmin: true, status: 'PENDING_INVITE' },
          ],
        },
      },
    })

    // 1. The active roster (lib/clubMembers.ts) contains only the two ACTIVE members.
    const roster = await getActiveRoster(club.id)
    expect(roster).toHaveLength(2)
    expect(roster.map((m) => m.userId).sort()).toEqual([active.id, owner.id].sort())
    expect(roster.some((m) => m.userId === pendingApp.id)).toBe(false)
    expect(roster.some((m) => m.userId === pendingInvite.id)).toBe(false)

    // 2. The pending rows do NOT satisfy the ACTIVE-admin authz check, despite isAdmin:true.
    expect(await getActiveAdminMembership(club.id, pendingApp.id)).toBeNull()
    expect(await getActiveAdminMembership(club.id, pendingInvite.id)).toBeNull()
    // Sanity: the real ACTIVE admin (owner) DOES pass.
    expect(await getActiveAdminMembership(club.id, owner.id)).not.toBeNull()

    // 3. The public club list's member count reflects only ACTIVE members (2), not 4.
    const listRes = await GET_CLUBS(new Request(`http://localhost/api/clubs?q=${encodeURIComponent(club.name)}`))
    const listBody = await listRes.json()
    const listedClub = listBody.clubs.find((c: { id: string }) => c.id === club.id)
    expect(listedClub).toBeTruthy()
    expect(listedClub._count.members).toBe(2)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, active.id, pendingApp.id, pendingInvite.id] } } })
  })
})
