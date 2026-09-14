// tests/integration/collectionitem-purchase-backfill.test.ts (Issue #169)
// prisma/migrations/20260914181000_backfill_collectionitem_purchase_link verknüpft bestehende
// CollectionItem-Zeilen nachträglich mit ihrer Purchase-Zeile, aber NUR wo eindeutig (genau ein
// Kauf für dieselbe User+Beyblade-Kombination) — mehrdeutige Alt-Fälle (zwei Käufe derselben
// Beyblade) bleiben absichtlich unverknüpft. Führt die ECHTE Migrationsdatei gegen absichtlich
// "kaputte" (vor-#169) Testdaten aus, wie tests/integration/collectionitem-backfill.test.ts.
// CI-only (Postgres).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260914181000_backfill_collectionitem_purchase_link/migration.sql'),
  'utf8',
)

describe('CollectionItem.purchaseId-Backfill: eindeutig verknüpfen, mehrdeutig auslassen (#169)', () => {
  it('verknüpft eindeutige Alt-Fälle, lässt mehrdeutige (mehrere Käufe derselben Beyblade) unverknüpft, rührt bereits verknüpfte nicht an', async () => {
    const suffix = Date.now().toString(36)
    const userA = await prisma.user.create({ data: { username: `cpb_a_${suffix}`, passwordHash: 'x' } })
    const userB = await prisma.user.create({ data: { username: `cpb_b_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `cpb_blade_${suffix}`, category: 'BLADE', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `cpb_bit_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({ data: { name: `Set ${suffix}`, manufacturer: 'HASBRO', bladeId: blade.id, bitId: bit.id } })

    // User A: GENAU ein Kauf dieser Beyblade → eindeutig, soll verknüpft werden.
    const purchaseA = await prisma.purchase.create({ data: { userId: userA.id, beybladeId: beyblade.id } })
    const itemA = await prisma.collectionItem.create({
      data: { userId: userA.id, partOrBeyId: blade.id, sourceBeybladeId: beyblade.id }, // purchaseId bewusst NULL (Alt-Zeile)
    })

    // User B: ZWEI Käufe derselben Beyblade → mehrdeutig, soll NICHT verknüpft werden.
    await prisma.purchase.create({ data: { userId: userB.id, beybladeId: beyblade.id } })
    await prisma.purchase.create({ data: { userId: userB.id, beybladeId: beyblade.id } })
    const itemB = await prisma.collectionItem.create({
      data: { userId: userB.id, partOrBeyId: bit.id, sourceBeybladeId: beyblade.id },
    })

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    expect((await prisma.collectionItem.findUnique({ where: { id: itemA.id } }))?.purchaseId).toBe(purchaseA.id)
    expect((await prisma.collectionItem.findUnique({ where: { id: itemB.id } }))?.purchaseId).toBeNull()

    // Idempotenz: ein zweiter Lauf ändert nichts mehr.
    await prisma.$executeRawUnsafe(MIGRATION_SQL)
    expect((await prisma.collectionItem.findUnique({ where: { id: itemA.id } }))?.purchaseId).toBe(purchaseA.id)

    await prisma.collectionItem.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
    await prisma.purchase.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, bit.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } })
  })
})
