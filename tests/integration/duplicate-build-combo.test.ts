// tests/integration/duplicate-build-combo.test.ts
// Phase 20: the same three parts can never back two Build rows (@@unique([bladeId,
// ratchetId, bitId])). POST /api/builds pre-checks the combo and returns the EXISTING build
// ({ id, existing: true }) on a second personal-combo create — not a duplicate row, not a
// raw unique-constraint 500; the CatalogProposal BUILD-approval transaction answers 409
// combo_exists with the existing Build's id instead of blowing past the constraint. New
// personal combos get the canonical "<Blade> <Ratchet><Bit-short>" name automatically.
// CI-only (Postgres/Redis). Auth-mocking pattern per build-ratings.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as CREATE_BUILD } from '@/app/api/builds/route'
import { PATCH as REVIEW } from '@/app/api/admin/proposals/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { deriveBuildName } from '@/lib/buildNaming'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], builds: [] as string[], proposals: [] as string[] }

async function makeUser(tag: string, role: 'USER' | 'TRUSTED' = 'USER') {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `dbc_${tag}_${suffix}`, passwordHash: 'x', role } })
  ids.users.push(user.id)
  return user
}

async function makeParts(suffix: string) {
  const blade = await prisma.part.create({ data: { name: `Circle Ghost ${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: '4-60', category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: 'Low Rush', category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  return { blade, ratchet, bit }
}

function postCombo(parts: { blade: { id: string }; ratchet: { id: string }; bit: { id: string } }) {
  return new Request('http://localhost/api/builds', {
    method: 'POST',
    body: JSON.stringify({ bladeId: parts.blade.id, ratchetId: parts.ratchet.id, bitId: parts.bit.id, type: null }),
  })
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.catalogProposal.deleteMany({ where: { id: { in: ids.proposals } } })
  await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids.builds } } })
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('duplicate build combo prevention (Phase 20)', () => {
  it('POST /api/builds requires a session (401 anonymous)', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await CREATE_BUILD(
      new Request('http://localhost/api/builds', { method: 'POST', body: JSON.stringify({ bladeId: 'x', ratchetId: 'y', bitId: 'z' }) }),
    )
    expect(res.status).toBe(401)
  })

  it('a personal combo gets the canonical name; creating the same combo again returns the existing build — no duplicate row, no 500', async () => {
    const user = await makeUser('owner')
    const parts = await makeParts(Date.now().toString(36))
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const first = await CREATE_BUILD(postCombo(parts))
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string; existing: boolean; build: { id: string; name: string; isOfficialSet: boolean } }
    expect(firstBody.existing).toBe(false)
    ids.builds.push(firstBody.id)
    expect(firstBody.build.isOfficialSet).toBe(false)
    // canonical "<Blade> <Ratchet><Bit-short>" auto-naming (bit short code from "Low Rush" → "LR")
    expect(firstBody.build.name).toBe(deriveBuildName(parts.blade.name, parts.ratchet.name, parts.bit.name))
    expect(firstBody.build.name).toContain('4-60LR')

    const second = await CREATE_BUILD(postCombo(parts))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string; existing: boolean; build: { id: string } }
    expect(secondBody.existing).toBe(true)
    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.build.id).toBe(firstBody.id)

    // exactly ONE Build row backs the combo
    const rows = await prisma.build.findMany({ where: { bladeId: parts.blade.id, ratchetId: parts.ratchet.id, bitId: parts.bit.id } })
    expect(rows).toHaveLength(1)
  })

  it('CatalogProposal BUILD approval of an already-existing combo answers 409 combo_exists with the existing Build id', async () => {
    const suffix = Date.now().toString(36)
    const submitter = await makeUser('sub')
    const trusted = await makeUser('trs', 'TRUSTED')
    const parts = await makeParts(suffix)

    // the combo already exists (e.g. seeded or created earlier)
    const existing = await prisma.build.create({
      data: { bladeId: parts.blade.id, ratchetId: parts.ratchet.id, bitId: parts.bit.id, name: `Retail Box ${suffix}`, isOfficialSet: true },
    })
    ids.builds.push(existing.id)

    const proposal = await prisma.catalogProposal.create({
      data: {
        kind: 'BUILD',
        submittedById: submitter.id,
        payload: {
          name: `Anders benanntes Set ${suffix}`,
          slots: {
            blade: { partId: parts.blade.id, inline: null },
            ratchet: { partId: parts.ratchet.id, inline: null },
            bit: { partId: parts.bit.id, inline: null },
          },
        },
      },
    })
    ids.proposals.push(proposal.id)

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const res = await REVIEW(
      new Request('http://localhost/api/admin/proposals', { method: 'PATCH', body: JSON.stringify({ id: proposal.id, status: 'APPROVED' }) }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; id: string; existing: boolean }
    expect(body.error).toBe('combo_exists')
    expect(body.existing).toBe(true)
    expect(body.id).toBe(existing.id)

    // still exactly one Build row, and the proposal stays PENDING for the curator to reject
    const rows = await prisma.build.findMany({ where: { bladeId: parts.blade.id, ratchetId: parts.ratchet.id, bitId: parts.bit.id } })
    expect(rows).toHaveLength(1)
    const row = await prisma.catalogProposal.findUnique({ where: { id: proposal.id } })
    expect(row?.status).toBe('PENDING')
  })
})
