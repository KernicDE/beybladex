// tests/unit/build-search-scope.test.ts (RC16 #102/#104; MVP4 #141 — Build-Split)
// Rollenverteilung Katalog vs. eigene Builds nach dem Split: searchBuilds kennt KEINE
// Scope-Filter mehr (kein isOfficialSet im Query — Builds sind ausschließlich persönliche
// Kombinationen; offizielle Sets leben im Beyblade-Modell und werden über searchBeyblades
// gelistet). Der Katalog-Tab (/collection?tab=katalog) und der Set-Picker nutzen
// lib/beybladeSearch.ts — dort matcht ein Query Name ODER productCode.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    build: { findMany: vi.fn() },
    beyblade: { findMany: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBuilds } from '@/lib/buildSearch'
import { searchBeyblades } from '@/lib/beybladeSearch'
import { ASSEMBLY_PART_SLOTS } from '@/lib/assembly'

const buildFindMany = vi.mocked(prisma.build.findMany)
const beybladeFindMany = vi.mocked(prisma.beyblade.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  buildFindMany.mockResolvedValue([] as never)
  beybladeFindMany.mockResolvedValue([] as never)
})

describe('searchBuilds nach dem Build-Split (MVP4 #141)', () => {
  it('ohne Scope-Filter keine isOfficialSet-Bedingung — der Query kennt den Begriff nicht mehr', async () => {
    await searchBuilds({})

    const call = buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }
    expect(JSON.stringify(call.where.AND)).not.toContain('isOfficialSet')
  })

  it('die q-Prefix-Suche läuft weiter über alle 7 Slot-Relationen PLUS den Build.name selbst (#164)', async () => {
    await searchBuilds({ q: 'Dran' })

    const call = buildFindMany.mock.calls[0][0] as { where: { AND: Array<{ OR?: unknown[] }> } }
    const orClause = call.where.AND.find((c) => Array.isArray(c.OR))
    // #164 — der angezeigte Titel ("Spear Scorpio 0-70Z") ist die kanonische Kombination aus
    // Blade+Ratchet+Bit-Kurzcode, KEIN einzelner Teilname; wer genau das eintippt, fand vorher
    // nichts. Ein zusätzlicher OR-Zweig auf Build.name behebt das.
    expect(orClause?.OR).toHaveLength(ASSEMBLY_PART_SLOTS.length + 1)
    expect(orClause?.OR).toContainEqual({ name: { startsWith: 'Dran', mode: 'insensitive' } })
  })
})

describe('searchBeyblades (Katalog-Tab / Set-Picker, MVP4 #141; Teilcode-Suche #144)', () => {
  it('matcht Name, productCode UND Teilnamen über alle 7 Slots (Präfix, case-insensitive)', async () => {
    await searchBeyblades({ q: 'G0290' })

    const call = beybladeFindMany.mock.calls[0][0] as { where: { AND: Array<{ OR?: unknown[] }> } }
    const orClause = call.where.AND.find((c) => Array.isArray(c.OR))
    expect(orClause?.OR).toEqual([
      { name: { startsWith: 'G0290', mode: 'insensitive' } },
      { productCode: { startsWith: 'G0290', mode: 'insensitive' } },
      // #144 — Teilcode-Suche: „4-60" findet alle Sets mit einem 4-60-Ratchet.
      ...ASSEMBLY_PART_SLOTS.map((slot) => ({ [slot]: { name: { startsWith: 'G0290', mode: 'insensitive' } } })),
    ])
  })

  it('ohne Query keine Bedingung — alle Sets, cursor-paginiert', async () => {
    await searchBeyblades({})

    const call = beybladeFindMany.mock.calls[0][0] as { where: { AND: unknown[] }; orderBy: unknown; take: number }
    expect(call.where.AND).toEqual([])
    expect(call.orderBy).toEqual({ id: 'asc' })
    expect(call.take).toBe(21) // PAGE_SIZE + 1
  })
})
