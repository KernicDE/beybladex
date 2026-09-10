// tests/integration/catalog-proposal-flow.test.ts
// Phase 11, item 1: the acceptance-critical proof for the catalog-proposal system — any USER
// can submit a PART or BUILD proposal; TRUSTED/JUDGE/ORGANIZER/ADMIN can approve (a plain USER
// cannot — negative test); approving a BUILD proposal creates the Part+Build rows
// transactionally; rejecting notifies the submitter with the review note. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as SUBMIT } from '@/app/api/proposals/route'
import { GET as LIST, PATCH as REVIEW } from '@/app/api/admin/proposals/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function formRequest(url: string, fields: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request(url, { method: 'POST', body: form })
}

async function seedUsers(suffix: string) {
  const submitter = await prisma.user.create({ data: { username: `cpf_sub_${suffix}`, passwordHash: 'x', role: 'USER' } })
  const trusted = await prisma.user.create({ data: { username: `cpf_trs_${suffix}`, passwordHash: 'x', role: 'TRUSTED' } })
  const judge = await prisma.user.create({ data: { username: `cpf_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
  const plainUser = await prisma.user.create({ data: { username: `cpf_usr_${suffix}`, passwordHash: 'x', role: 'USER' } })
  return { submitter, trusted, judge, plainUser }
}

describe('catalog proposal flow', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('anonymous submission is 401; any USER can submit a PART proposal', async () => {
    const suffix = Date.now().toString(36)
    const { submitter } = await seedUsers(suffix)
    const url = 'http://localhost/api/proposals'

    mockAuth.mockResolvedValue(asSession(null))
    const anon = await SUBMIT(formRequest(url, { kind: 'PART', name: 'X', manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' }))
    expect(anon.status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: submitter.id, name: submitter.username }))
    const res = await SUBMIT(
      formRequest(url, {
        kind: 'PART',
        name: `Testblade ${suffix}`,
        manufacturer: 'TT',
        category: 'BLADE',
        spinDirection: 'RIGHT',
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const row = await prisma.catalogProposal.findUnique({ where: { id } })
    expect(row?.kind).toBe('PART')
    expect(row?.status).toBe('PENDING')
    expect(row?.submittedById).toBe(submitter.id)

    await prisma.catalogProposal.delete({ where: { id } })
    await prisma.user.deleteMany({ where: { id: submitter.id } })
  })

  it('review: a plain USER cannot approve/reject (403); TRUSTED and JUDGE both can (widened reviewer tier)', async () => {
    const suffix = Date.now().toString(36)
    const { submitter, trusted, judge, plainUser } = await seedUsers(suffix)
    const proposal = await prisma.catalogProposal.create({
      data: { kind: 'PART', submittedById: submitter.id, payload: { name: `Reviewme ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT', beyType: null, weightGrams: null, notes: null } },
    })

    mockAuth.mockResolvedValue(asSession({ id: plainUser.id, name: plainUser.username }))
    const forbidden = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: proposal.id, status: 'APPROVED' }) }),
    )
    expect(forbidden.status).toBe(403)

    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))
    const list = await LIST()
    const listBody = (await list.json()) as { proposals: { id: string }[] }
    expect(listBody.proposals.some((p) => p.id === proposal.id)).toBe(true)

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const approved = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: proposal.id, status: 'APPROVED' }) }),
    )
    expect(approved.status).toBe(200)
    const { createdPartId } = (await approved.json()) as { createdPartId: string }
    const createdPart = await prisma.part.findUnique({ where: { id: createdPartId } })
    expect(createdPart?.name).toBe(`Reviewme ${suffix}`)

    await prisma.notification.deleteMany({ where: { userId: submitter.id } })
    await prisma.part.delete({ where: { id: createdPartId } })
    await prisma.user.deleteMany({ where: { id: { in: [submitter.id, trusted.id, judge.id, plainUser.id] } } })
  })

  it('approving a BUILD proposal creates the inline Part rows AND the official Build transactionally; rejecting requires and stores a reviewNote, and notifies the submitter', async () => {
    const suffix = Date.now().toString(36)
    const { submitter, trusted } = await seedUsers(suffix)

    const inlinePart = { name: `Bit${suffix}`, manufacturer: 'TT', beyType: null, spinDirection: 'RIGHT', weightGrams: null }
    const buildProposal = await prisma.catalogProposal.create({
      data: {
        kind: 'BUILD',
        submittedById: submitter.id,
        payload: {
          name: `Testset ${suffix}`,
          slots: {
            blade: { partId: null, inline: { ...inlinePart, name: `Blade${suffix}` } },
            ratchet: { partId: null, inline: { ...inlinePart, name: `Ratchet${suffix}` } },
            bit: { partId: null, inline: inlinePart },
          },
        },
      },
    })

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const approved = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: buildProposal.id, status: 'APPROVED' }) }),
    )
    expect(approved.status).toBe(200)
    const { createdBuildId } = (await approved.json()) as { createdBuildId: string }
    const build = await prisma.build.findUnique({ where: { id: createdBuildId } })
    expect(build?.isOfficialSet).toBe(true)
    expect(build?.name).toBe(`Testset ${suffix}`)
    const createdParts = await prisma.part.findMany({ where: { id: { in: [build!.bladeId, build!.ratchetId, build!.bitId] } } })
    expect(createdParts).toHaveLength(3)

    // Reject a second proposal, no note -> 400; with a note -> 200, stored, submitter notified.
    const rejectMe = await prisma.catalogProposal.create({
      data: { kind: 'PART', submittedById: submitter.id, payload: { name: `Rej${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT', beyType: null, weightGrams: null, notes: null } },
    })
    const noNote = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: rejectMe.id, status: 'REJECTED' }) }),
    )
    expect(noNote.status).toBe(400)
    const rejected = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: rejectMe.id, status: 'REJECTED', reviewNote: 'Doppelter Eintrag' }) }),
    )
    expect(rejected.status).toBe(200)
    const rejectedRow = await prisma.catalogProposal.findUnique({ where: { id: rejectMe.id } })
    expect(rejectedRow?.reviewNote).toBe('Doppelter Eintrag')
    const notification = await prisma.notification.findFirst({ where: { userId: submitter.id, title: { contains: 'abgelehnt' } } })
    expect(notification).not.toBeNull()

    await prisma.notification.deleteMany({ where: { userId: submitter.id } })
    await prisma.catalogProposal.deleteMany({ where: { id: { in: [rejectMe.id] } } })
    await prisma.build.delete({ where: { id: createdBuildId } })
    await prisma.part.deleteMany({ where: { id: { in: createdParts.map((p) => p.id) } } })
    await prisma.user.deleteMany({ where: { id: { in: [submitter.id, trusted.id] } } })
  })
})
