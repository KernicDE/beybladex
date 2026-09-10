// tests/integration/mark-set-purchased.test.ts
// Phase 11, item 6: marking an official Set purchased creates exactly three CollectionItem
// rows sharing sourceBuildId, each independently editable/deletable afterward (proven by
// deleting just one and confirming the other two survive). A non-official Build (a personal
// combo) is rejected. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as MARK_PURCHASED } from '@/app/api/collection/mark-set-purchased/route'
import { DELETE as DELETE_ITEM } from '@/app/api/collection/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(body: unknown) {
  return new Request('http://localhost/api/collection/mark-set-purchased', { method: 'POST', body: JSON.stringify(body) })
}

async function makeSet(suffix: string, official: boolean) {
  const blade = await prisma.part.create({ data: { name: `msp_blade_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `msp_ratchet_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `msp_bit_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const build = await prisma.build.create({
    data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK', isOfficialSet: official, name: official ? `Set ${suffix}` : null },
  })
  return { blade, ratchet, bit, build }
}

describe('mark set purchased', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('creates exactly three linked CollectionItem rows for an official Set; a non-official build is rejected', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `msp_usr_${suffix}`, passwordHash: 'x' } })
    const official = await makeSet(`${suffix}o`, true)
    const casual = await makeSet(`${suffix}c`, false)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const badRes = await MARK_PURCHASED(req({ buildId: casual.build.id }))
    expect(badRes.status).toBe(400)
    expect((await badRes.json()).error).toBe('not_an_official_set')

    const res = await MARK_PURCHASED(req({ buildId: official.build.id, purchasePrice: 39.99, currency: 'EUR', merchant: 'Testladen' }))
    expect(res.status).toBe(201)
    const { ids } = (await res.json()) as { ids: string[] }
    expect(ids).toHaveLength(3)

    const rows = await prisma.collectionItem.findMany({ where: { id: { in: ids } } })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.sourceBuildId === official.build.id)).toBe(true)
    expect(rows.every((r) => r.merchant === 'Testladen')).toBe(true)
    const partIds = rows.map((r) => r.partOrBeyId).sort()
    expect(partIds).toEqual([official.bit.id, official.blade.id, official.ratchet.id].sort())

    // Each row stays independently deletable — deleting one leaves the other two intact.
    const delRes = await DELETE_ITEM(new Request(`http://localhost/api/collection/${ids[0]}`, { method: 'DELETE' }), { params: Promise.resolve({ id: ids[0] }) })
    expect(delRes.status).toBe(204)
    const remaining = await prisma.collectionItem.findMany({ where: { id: { in: ids } } })
    expect(remaining).toHaveLength(2)

    await prisma.collectionItem.deleteMany({ where: { id: { in: ids } } })
    await prisma.build.deleteMany({ where: { id: { in: [official.build.id, casual.build.id] } } })
    await prisma.part.deleteMany({
      where: { id: { in: [official.blade.id, official.ratchet.id, official.bit.id, casual.blade.id, casual.ratchet.id, casual.bit.id] } },
    })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
