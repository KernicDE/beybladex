// tests/integration/beyblade-purchase-inventory.test.ts (#137-Nachtrag — Live-Bug-Report)
// POST /api/beyblades/[id]/purchases ist der Button auf der Beyblade-Detailseite — der Weg,
// den echte Nutzer:innen tatsächlich gehen, um ein Set als gekauft zu markieren. Live
// reproduziert: danach zeigte der Katalog "✓ Im Besitz" (Purchase-basiert), aber "Mein
// Inventar" (CollectionItem-basiert) blieb leer — diese Route schrieb vorher NUR die
// Purchase-Row (PR #142 hatte das bewusst getrennt, siehe lib/beybladePurchase.ts für die
// Zusammenführung). Deckt den vollen Round-Trip gegen die echte DB ab, inklusive derselben
// Inventar-Query-Form wie app/collection/page.tsx. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as POST_PURCHASE } from '@/app/api/beyblades/[id]/purchases/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('POST /api/beyblades/[id]/purchases → Mein Inventar (#137-Nachtrag)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('erzeugt CollectionItem-Zeilen, die dieselbe Query wie "Mein Inventar" findet', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `bpi_usr_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `bpi_blade_${suffix}`, category: 'BLADE', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `bpi_ratchet_${suffix}`, category: 'RATCHET', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `bpi_bit_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({
      data: { name: `Set ${suffix}`, manufacturer: 'HASBRO', bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id },
    })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await POST_PURCHASE(
      new Request(`http://localhost/api/beyblades/${beyblade.id}/purchases`, {
        method: 'POST',
        body: JSON.stringify({ merchant: 'Testladen', boughtAt: '2026-09-14' }),
      }),
      { params: Promise.resolve({ id: beyblade.id }) },
    )
    expect(res.status).toBe(201)
    const { itemIds } = (await res.json()) as { purchaseId: string; itemIds: string[] }
    expect(itemIds).toHaveLength(3)

    // Genau dieselbe Query-Form wie app/collection/page.tsx "Mein Inventar".
    const inventory = await prisma.collectionItem.findMany({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
      select: { id: true, part: { select: { name: true } } },
    })
    expect(inventory.map((r) => r.part.name).sort()).toEqual([blade.name, ratchet.name, bit.name].sort())

    // "✓ Im Besitz" auf dem Beyblades-Tab (Purchase-basiert) UND "Mein Inventar" (CollectionItem-
    // basiert) müssen jetzt konsistent beide den Kauf zeigen — genau die Diskrepanz aus dem Report.
    const purchases = await prisma.purchase.findMany({ where: { userId: user.id, beybladeId: beyblade.id } })
    expect(purchases).toHaveLength(1)

    await prisma.collectionItem.deleteMany({ where: { userId: user.id } })
    await prisma.purchase.deleteMany({ where: { userId: user.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, ratchet.id, bit.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
