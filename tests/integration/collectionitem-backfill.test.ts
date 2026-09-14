// tests/integration/collectionitem-backfill.test.ts (#137 Root-Cause-Fix)
// prisma/migrations/20260914110000_backfill_collectionitem_from_purchases/migration.sql trägt
// CollectionItem-Provenienz für Purchase-Zeilen nach, die vor dem lib/beybladePurchase.ts-Fix
// entstanden sind (POST /api/beyblades/[id]/purchases schrieb bis dahin nur die Purchase-Zeile
// — "Im Besitz" im Katalog stimmte, "Mein Inventar" blieb leer). Führt die ECHTE
// Migrationsdatei (nicht eine Kopie) gegen absichtlich "kaputte" Testdaten aus — so bleibt der
// Test automatisch synchron mit der Migration statt separat zu drifted. CI-only (Postgres).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260914110000_backfill_collectionitem_from_purchases/migration.sql'),
  'utf8',
)

describe('CollectionItem-Backfill aus Purchase (#137)', () => {
  it('trägt fehlende Teile-Zeilen für einen "verwaisten" Kauf nach (Felder vom jüngsten Kauf)', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `bf_usr_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `bf_blade_${suffix}`, category: 'BLADE', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `bf_bit_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({
      data: { name: `Set ${suffix}`, manufacturer: 'HASBRO', bladeId: blade.id, bitId: bit.id },
    })

    // Simuliert den Bug: zwei Purchase-Zeilen (der ältere und der jüngste Kauf), aber KEINE
    // CollectionItem-Zeile — genau der Zustand, in dem echte Nutzer:innen jetzt stecken.
    await prisma.purchase.create({
      data: { userId: user.id, beybladeId: beyblade.id, price: 10, currency: 'EUR', merchant: 'Alter Laden', createdAt: new Date('2026-01-01') },
    })
    await prisma.purchase.create({
      data: { userId: user.id, beybladeId: beyblade.id, price: 25.5, currency: 'USD', merchant: 'Neuer Laden', boughtAt: new Date('2026-09-01'), createdAt: new Date('2026-09-10') },
    })

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    const items = await prisma.collectionItem.findMany({ where: { userId: user.id }, select: { partOrBeyId: true, purchasePrice: true, currency: true, merchant: true, sourceBeybladeId: true } })
    expect(items).toHaveLength(2) // nur Blade + Bit (Ratchet-Integrated-Set ohne Ratchet-Teil)
    expect(items.map((i) => i.partOrBeyId).sort()).toEqual([blade.id, bit.id].sort())
    // Felder vom JÜNGSTEN Kauf (Neuer Laden, 25.5 USD), nicht vom ältesten.
    for (const item of items) {
      expect(item.merchant).toBe('Neuer Laden')
      expect(item.purchasePrice).toBe(25.5)
      expect(item.currency).toBe('USD')
      expect(item.sourceBeybladeId).toBe(beyblade.id)
    }

    // Idempotenz: ein zweiter Lauf legt NICHTS doppelt an (NOT EXISTS greift jetzt).
    await prisma.$executeRawUnsafe(MIGRATION_SQL)
    const afterSecondRun = await prisma.collectionItem.findMany({ where: { userId: user.id } })
    expect(afterSecondRun).toHaveLength(2)

    await prisma.collectionItem.deleteMany({ where: { userId: user.id } })
    await prisma.purchase.deleteMany({ where: { userId: user.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, bit.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('lässt bereits korrekt im Inventar stehende Käufe unangetastet (kein Doppel-Nachtrag)', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `bf_ok_${suffix}`, passwordHash: 'x' } })
    const bit = await prisma.part.create({ data: { name: `bf_ok_bit_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
    const beyblade = await prisma.beyblade.create({ data: { name: `Set ok ${suffix}`, manufacturer: 'HASBRO', bitId: bit.id } })

    await prisma.purchase.create({ data: { userId: user.id, beybladeId: beyblade.id } })
    // Bereits korrekt via mark-set-purchased/beybladePurchase angelegt (der Weg, den der Fix jetzt garantiert).
    const existing = await prisma.collectionItem.create({
      data: { userId: user.id, partOrBeyId: bit.id, sourceBeybladeId: beyblade.id },
    })

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    const items = await prisma.collectionItem.findMany({ where: { userId: user.id } })
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe(existing.id)

    await prisma.collectionItem.deleteMany({ where: { userId: user.id } })
    await prisma.purchase.deleteMany({ where: { userId: user.id } })
    await prisma.beyblade.delete({ where: { id: beyblade.id } })
    await prisma.part.delete({ where: { id: bit.id } })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
