// tests/integration/mark-set-purchased.test.ts (Phase 11, item 6; RC16 #122; MVP4 #141)
// "Set als gekauft markieren" nach dem Build-Split: der Body trägt beybladeId (offizielle Sets
// leben im Beyblade-Modell). Ein erfolgreicher Call schreibt GENAU EINE Purchase-Row (Besitz-
// Einheit, Basis des Preisverlaufs — unbegrenzt viele pro User+Set, hier 2× hintereinander)
// plus je belegtem Slot eine CollectionItem-Row mit sourceBeybladeId-Provenienz, die
// einzeln editier-/löschbar bleibt (proven by deleting just one and confirming the other two
// survive). Eine unbekannte BeybladeId → 404. CI-only (Postgres/Redis).
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

async function makeSet(suffix: string) {
  const blade = await prisma.part.create({ data: { name: `msp_blade_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `msp_ratchet_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `msp_bit_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const beyblade = await prisma.beyblade.create({
    data: {
      name: `Set ${suffix}`,
      manufacturer: 'TT',
      bladeId: blade.id,
      ratchetId: ratchet.id,
      bitId: bit.id,
    },
  })
  return { blade, ratchet, bit, beyblade }
}

describe('mark set purchased (MVP4 #141)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('creates one Purchase plus three linked CollectionItem rows; purchases are unlimited per user+set', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `msp_usr_${suffix}`, passwordHash: 'x' } })
    const { blade, ratchet, bit, beyblade } = await makeSet(suffix)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const unknown = await MARK_PURCHASED(req({ beybladeId: 'does-not-exist' }))
    expect(unknown.status).toBe(404)

    const res = await MARK_PURCHASED(req({ beybladeId: beyblade.id, purchasePrice: 39.99, currency: 'EUR', merchant: 'Testladen' }))
    expect(res.status).toBe(201)
    const { purchaseId, ids } = (await res.json()) as { purchaseId: string; ids: string[] }
    expect(ids).toHaveLength(3)

    // Wiederholungskäufe sind erlaubt — eine zweite Purchase, drei weitere CollectionItems.
    const again = await MARK_PURCHASED(req({ beybladeId: beyblade.id }))
    expect(again.status).toBe(201)
    const second = (await again.json()) as { purchaseId: string; ids: string[] }
    expect(second.purchaseId).not.toBe(purchaseId)
    const purchases = await prisma.purchase.findMany({ where: { userId: user.id, beybladeId: beyblade.id } })
    expect(purchases).toHaveLength(2)
    const first = purchases.find((p) => p.id === purchaseId)!
    expect(first.price).toBe(39.99)
    expect(first.currency).toBe('EUR')
    expect(first.merchant).toBe('Testladen')
    expect(first.boughtAt).toBeNull()

    const rows = await prisma.collectionItem.findMany({ where: { id: { in: ids } } })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.sourceBeybladeId === beyblade.id)).toBe(true)
    expect(rows.every((r) => r.merchant === 'Testladen')).toBe(true)
    const partIds = rows.map((r) => r.partOrBeyId).sort()
    expect(partIds).toEqual([bit.id, blade.id, ratchet.id].sort())

    // Each row stays independently deletable — deleting one leaves the other two intact.
    const delRes = await DELETE_ITEM(new Request(`http://localhost/api/collection/${ids[0]}`, { method: 'DELETE' }), { params: Promise.resolve({ id: ids[0] }) })
    expect(delRes.status).toBe(200)
    const remaining = await prisma.collectionItem.findMany({ where: { id: { in: ids } } })
    expect(remaining).toHaveLength(2)

    await prisma.collectionItem.deleteMany({ where: { userId: user.id } })
    await prisma.purchase.deleteMany({ where: { userId: user.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, ratchet.id, bit.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
