// tests/integration/purchase-delete-cascade.test.ts (Issue #169)
// "Teile werden nicht mit Beyblade gelöscht" — Live-Report: DELETE /api/purchases/[id] entfernte
// bisher nur die Purchase-Zeile, die zugehörigen CollectionItem-Teile blieben als Karteileichen
// in "Mein Inventar" zurück. Jetzt kaskadiert das DB-seitig über CollectionItem.purchaseId
// (onDelete: Cascade) — dieser Test deckt den vollen Round-Trip über die echte Route gegen die
// echte DB ab, inklusive des Negativfalls (zweiter, unabhängiger Kauf bleibt unangetastet).
// CI-only (Postgres).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as POST_PURCHASE } from '@/app/api/beyblades/[id]/purchases/route'
import { DELETE as DELETE_PURCHASE } from '@/app/api/purchases/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('DELETE /api/purchases/[id] → kaskadiert auf CollectionItem (#169)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('löscht beim Kauf-Löschen auch dessen Teile aus der Sammlung, lässt einen anderen Kauf derselben Beyblade unangetastet', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `pdc_usr_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `pdc_blade_${suffix}`, category: 'BLADE', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `pdc_bit_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({
      data: { name: `Set ${suffix}`, manufacturer: 'HASBRO', bladeId: blade.id, bitId: bit.id },
    })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    // Zwei unabhängige Käufe DERSELBEN Beyblade — der zweite ist die Regressionsschutz-Kontrolle:
    // löscht man den ersten, dürfen die Teile des zweiten nicht mitverschwinden.
    const res1 = await POST_PURCHASE(
      new Request(`http://localhost/api/beyblades/${beyblade.id}/purchases`, { method: 'POST', body: JSON.stringify({ merchant: 'Laden A' }) }),
      { params: Promise.resolve({ id: beyblade.id }) },
    )
    const { purchaseId: purchase1Id, itemIds: items1 } = (await res1.json()) as { purchaseId: string; itemIds: string[] }
    const res2 = await POST_PURCHASE(
      new Request(`http://localhost/api/beyblades/${beyblade.id}/purchases`, { method: 'POST', body: JSON.stringify({ merchant: 'Laden B' }) }),
      { params: Promise.resolve({ id: beyblade.id }) },
    )
    const { itemIds: items2 } = (await res2.json()) as { purchaseId: string; itemIds: string[] }

    const before = await prisma.collectionItem.count({ where: { userId: user.id } })
    expect(before).toBe(4) // 2 Teile × 2 Käufe

    const delRes = await DELETE_PURCHASE(new Request(`http://localhost/api/purchases/${purchase1Id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: purchase1Id }),
    })
    expect(delRes.status).toBe(200)

    // Kauf 1 ist weg, SEINE Teile sind weg — Kauf 2 und dessen Teile bleiben unberührt.
    expect(await prisma.purchase.findUnique({ where: { id: purchase1Id } })).toBeNull()
    expect(await prisma.collectionItem.findMany({ where: { id: { in: items1 } } })).toHaveLength(0)
    expect(await prisma.collectionItem.findMany({ where: { id: { in: items2 } } })).toHaveLength(2)

    await prisma.collectionItem.deleteMany({ where: { userId: user.id } })
    await prisma.purchase.deleteMany({ where: { userId: user.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, bit.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('gibt 404 für einen Kauf, der nicht der Session-Nutzerin/dem Session-Nutzer gehört (kein Leak, kein Cascade fremder Daten)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `pdc_owner_${suffix}`, passwordHash: 'x' } })
    const attacker = await prisma.user.create({ data: { username: `pdc_attacker_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `pdc_blade2_${suffix}`, category: 'BLADE', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `pdc_bit2_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({ data: { name: `Set2 ${suffix}`, manufacturer: 'HASBRO', bladeId: blade.id, bitId: bit.id } })

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await POST_PURCHASE(
      new Request(`http://localhost/api/beyblades/${beyblade.id}/purchases`, { method: 'POST', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: beyblade.id }) },
    )
    const { purchaseId, itemIds } = (await res.json()) as { purchaseId: string; itemIds: string[] }

    mockAuth.mockResolvedValue(asSession({ id: attacker.id, name: attacker.username }))
    const delRes = await DELETE_PURCHASE(new Request(`http://localhost/api/purchases/${purchaseId}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: purchaseId }),
    })
    expect(delRes.status).toBe(404)
    expect(await prisma.collectionItem.findMany({ where: { id: { in: itemIds } } })).toHaveLength(2)

    await prisma.collectionItem.deleteMany({ where: { userId: owner.id } })
    await prisma.purchase.deleteMany({ where: { userId: owner.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, bit.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, attacker.id] } } })
  })
})
