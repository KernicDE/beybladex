// tests/integration/build-name-backfill.test.ts (#164-Nachtrag)
// prisma/migrations/20260914140000_backfill_empty_build_name_to_null räumt bestehende
// Build-Zeilen mit leerem/nur-Leerzeichen-Namen auf NULL auf (Live-Report "hier steht kein
// Name"). Führt die ECHTE Migrationsdatei gegen absichtlich "kaputte" Testdaten aus, wie
// tests/integration/collectionitem-backfill.test.ts. CI-only (Postgres).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260914140000_backfill_empty_build_name_to_null/migration.sql'),
  'utf8',
)

describe('Build.name-Backfill: leer/Leerzeichen → NULL (#164-Nachtrag)', () => {
  it('räumt leere und nur-Leerzeichen-Namen auf NULL auf, lässt echte Namen unangetastet', async () => {
    const suffix = Date.now().toString(36)
    const blade = await prisma.part.create({ data: { name: `bnb_blade_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    // RC16 (#122) — Build.bladeId+ratchetId+bitId (u. a.) sind ein Unique-Index (comboWhere):
    // jeder Test-Build braucht eine EIGENE Teile-Kombination, sonst schlägt das zweite create
    // mit P2002 fehl. Vier eigene Bits statt eines gemeinsamen.
    const bits = await Promise.all(
      ['empty', 'ws', 'real', 'null'].map((tag) =>
        prisma.part.create({ data: { name: `bnb_bit_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } }),
      ),
    )

    const empty = await prisma.build.create({ data: { bladeId: blade.id, bitId: bits[0]!.id, type: 'ATTACK', name: '' } })
    const whitespace = await prisma.build.create({ data: { bladeId: blade.id, bitId: bits[1]!.id, type: 'ATTACK', name: '   ' } })
    const real = await prisma.build.create({ data: { bladeId: blade.id, bitId: bits[2]!.id, type: 'ATTACK', name: 'Mein Build' } })
    const alreadyNull = await prisma.build.create({ data: { bladeId: blade.id, bitId: bits[3]!.id, type: 'ATTACK', name: null } })

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    expect((await prisma.build.findUnique({ where: { id: empty.id } }))?.name).toBeNull()
    expect((await prisma.build.findUnique({ where: { id: whitespace.id } }))?.name).toBeNull()
    expect((await prisma.build.findUnique({ where: { id: real.id } }))?.name).toBe('Mein Build')
    expect((await prisma.build.findUnique({ where: { id: alreadyNull.id } }))?.name).toBeNull()

    // Idempotenz: ein zweiter Lauf ändert nichts mehr.
    await prisma.$executeRawUnsafe(MIGRATION_SQL)
    expect((await prisma.build.findUnique({ where: { id: real.id } }))?.name).toBe('Mein Build')

    await prisma.build.deleteMany({ where: { id: { in: [empty.id, whitespace.id, real.id, alreadyNull.id] } } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, ...bits.map((b) => b.id)] } } })
  })
})
