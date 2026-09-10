// tests/integration/proposal-approve-race.test.ts
// [RC2 #53] Two concurrent PATCH approvals of the SAME pending PART proposal: the old
// check-then-act (read status → create Part → flip status) let both transactions create a Part
// row. The conditional claim (updateMany WHERE id AND status='PENDING' as the FIRST statement
// of the settle transaction) ensures only one reviewer wins; the loser gets 409 already_reviewed
// and NO second Part row exists. Also covers the reject path. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PATCH as REVIEW } from '@/app/api/admin/proposals/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function reviewReq(id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) {
  return new Request('http://localhost/api/admin/proposals', {
    method: 'PATCH',
    body: JSON.stringify({ id, status, ...(reviewNote ? { reviewNote } : {}) }),
  })
}

describe('admin proposal review race', () => {
  afterEach(() => mockAuth.mockReset())

  it('two concurrent approvals of the same PART proposal create exactly one Part row', async () => {
    const suffix = Date.now().toString(36)
    const submitter = await prisma.user.create({ data: { username: `par_sub_${suffix}`, passwordHash: 'x' } })
    const curatorA = await prisma.user.create({ data: { username: `par_a_${suffix}`, passwordHash: 'x', role: 'TRUSTED' } })
    const curatorB = await prisma.user.create({ data: { username: `par_b_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const proposal = await prisma.catalogProposal.create({
      data: {
        kind: 'PART',
        submittedById: submitter.id,
        payload: { name: `Raceblade ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT', beyType: null, weightGrams: null, notes: null },
      },
    })
    const partName = `Raceblade ${suffix}`

    // Fired without awaiting between them: both PATCHes read status='PENDING' before either
    // transaction commits, so only the conditional claim inside the transaction decides.
    mockAuth.mockResolvedValue(asSession({ id: curatorA.id, name: curatorA.username }))
    const aPromise = REVIEW(reviewReq(proposal.id, 'APPROVED'))
    mockAuth.mockResolvedValue(asSession({ id: curatorB.id, name: curatorB.username }))
    const bPromise = REVIEW(reviewReq(proposal.id, 'APPROVED'))
    const [rA, rB] = await Promise.all([aPromise, bPromise])

    const statuses = [rA.status, rB.status].sort()
    expect(statuses).toEqual([200, 409])
    const loser = rA.status === 409 ? rA : rB
    expect((await loser.json()).error).toBe('already_reviewed')

    // The acceptance criterion: exactly ONE Part row, and the proposal is settled once.
    const parts = await prisma.part.findMany({ where: { name: partName } })
    expect(parts).toHaveLength(1)
    const settled = await prisma.catalogProposal.findUnique({ where: { id: proposal.id } })
    expect(settled).toMatchObject({ status: 'APPROVED' })
    // Exactly one approval audit row — the loser's transaction rolled back before its audit
    // insert. (The audit row's targetId is the created Part id, so match on the summary.)
    const audits = await prisma.auditLog.count({ where: { action: 'catalog_proposal.approve', summary: { contains: partName } } })
    expect(audits).toBe(1)

    await prisma.part.delete({ where: { id: parts[0].id } })
    await prisma.catalogProposal.delete({ where: { id: proposal.id } })
    await prisma.user.deleteMany({ where: { id: { in: [submitter.id, curatorA.id, curatorB.id] } } })
  })

  it('two concurrent reject/approve of the same proposal settle it exactly once', async () => {
    const suffix = Date.now().toString(36)
    const submitter = await prisma.user.create({ data: { username: `prr_sub_${suffix}`, passwordHash: 'x' } })
    const curatorA = await prisma.user.create({ data: { username: `prr_a_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const curatorB = await prisma.user.create({ data: { username: `prr_b_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const proposal = await prisma.catalogProposal.create({
      data: {
        kind: 'PART',
        submittedById: submitter.id,
        payload: { name: `Racebit ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT', beyType: null, weightGrams: null, notes: null },
      },
    })

    mockAuth.mockResolvedValue(asSession({ id: curatorA.id, name: curatorA.username }))
    const aPromise = REVIEW(reviewReq(proposal.id, 'REJECTED', 'Duplikat'))
    mockAuth.mockResolvedValue(asSession({ id: curatorB.id, name: curatorB.username }))
    const bPromise = REVIEW(reviewReq(proposal.id, 'APPROVED'))
    const [rA, rB] = await Promise.all([aPromise, bPromise])

    const statuses = [rA.status, rB.status].sort()
    expect(statuses).toEqual([200, 409])
    // Whichever won: exactly one settled state, no Part row from a losing approval.
    const settled = await prisma.catalogProposal.findUnique({ where: { id: proposal.id } })
    expect(['APPROVED', 'REJECTED']).toContain(settled!.status)
    expect(await prisma.part.count({ where: { name: `Racebit ${suffix}` } })).toBe(settled!.status === 'APPROVED' ? 1 : 0)

    await prisma.part.deleteMany({ where: { name: `Racebit ${suffix}` } })
    await prisma.catalogProposal.delete({ where: { id: proposal.id } })
    await prisma.user.deleteMany({ where: { id: { in: [submitter.id, curatorA.id, curatorB.id] } } })
  })
})
