// tests/unit/beyblade-search-filters.test.ts (MVP4/4, #144)
// Filter- und Such-Logik des Beyblades-Katalog-Tabs: Hersteller-/Typ-Filter, "nur im Besitz"
// (Purchase-Subquery) und die Teilcode-Suche (Query matcht auch Teilnamen über alle 7 Slots).
// Seams mocked on '@/' imports (lib/db), same pattern as tests/unit/build-search-mine.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    beyblade: { findMany: vi.fn(), count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBeyblades } from '@/lib/beybladeSearch'

const findMany = vi.mocked(prisma.beyblade.findMany)
const count = vi.mocked(prisma.beyblade.count)

function callWhere() {
  return (findMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([] as never)
  count.mockResolvedValue(0 as never)
})

describe('searchBeyblades filter composition (#144)', () => {
  it('filters by manufacturer', async () => {
    await searchBeyblades({ manufacturer: 'TT' })
    expect(callWhere().AND).toContainEqual({ manufacturer: 'TT' })
  })

  it('derives the type filter from blade OR lockChip (no type column on Beyblade)', async () => {
    await searchBeyblades({ type: 'ATTACK' })
    expect(callWhere().AND).toContainEqual({
      OR: [{ blade: { beyType: 'ATTACK' } }, { lockChip: { beyType: 'ATTACK' } }],
    })
  })

  it('derives the spin-direction filter from blade OR lockChip (#188 — Parität zum Teile-Tab)', async () => {
    await searchBeyblades({ spinDirection: 'LEFT' })
    expect(callWhere().AND).toContainEqual({
      OR: [{ blade: { spinDirection: 'LEFT' } }, { lockChip: { spinDirection: 'LEFT' } }],
    })
  })

  it('restricts to owned sets via a Purchase subquery when ownedByUserId is set', async () => {
    await searchBeyblades({ ownedByUserId: 'user-1' })
    expect(callWhere().AND).toContainEqual({ purchases: { some: { userId: 'user-1' } } })
  })

  it('adds no filter clauses when no filter is active', async () => {
    await searchBeyblades({})
    expect(callWhere().AND).toEqual([])
  })

  it('keeps the plain list unfiltered for the set picker (GET /api/beyblades)', async () => {
    await searchBeyblades({ q: 'Dran' })
    const clauses = callWhere().AND
    // Nur der Such-Clause, kein Hersteller-/Typ-/Besitz-Filter.
    expect(clauses).toHaveLength(1)
  })
})

describe('searchBeyblades Teilcode-Suche (#144)', () => {
  it('matches part names across ALL 7 slot relations (e.g. "4-60" finds 4-60 ratchets)', async () => {
    await searchBeyblades({ q: '4-60' })
    const or = (callWhere().AND[0] as { OR: Record<string, unknown>[] }).OR
    const slotClauses = or.slice(2) // erst name, dann productCode
    const slots = slotClauses.map((clause) => Object.keys(clause)[0]).sort()
    expect(slots).toEqual(
      ['assistBlade', 'bit', 'blade', 'lockChip', 'metalBlade', 'overBlade', 'ratchet'].sort(),
    )
    for (const clause of slotClauses) {
      const field = Object.values(clause)[0] as { name: { startsWith: string; mode: string } }
      expect(field.name.startsWith).toBe('4-60')
      expect(field.name.mode).toBe('insensitive')
    }
  })

  it('matches name and productCode alongside part names', async () => {
    await searchBeyblades({ q: 'dran' })
    const or = (callWhere().AND[0] as { OR: Record<string, unknown>[] }).OR
    expect(Object.keys(or[0])).toEqual(['name'])
    expect(Object.keys(or[1])).toEqual(['productCode'])
  })

  it('combines the search clause with all filters', async () => {
    await searchBeyblades({ q: '4-60', manufacturer: 'HASBRO', type: 'ATTACK', spinDirection: 'RIGHT', ownedByUserId: 'user-1' })
    expect(callWhere().AND).toHaveLength(5)
  })
})

describe('searchBeyblades page (#155 — echte Seitenzahlen)', () => {
  it('nutzt skip/take statt Cursor und liefert totalPages aus einer COUNT-Query mit demselben where', async () => {
    count.mockResolvedValueOnce(45 as never)
    const result = await searchBeyblades({ page: 2, take: 20, manufacturer: 'TT' })

    const call = findMany.mock.calls[0][0] as { skip: number; take: number; cursor?: unknown }
    expect(call.skip).toBe(20)
    expect(call.take).toBe(20)
    expect(call.cursor).toBeUndefined()

    expect(count).toHaveBeenCalledWith({ where: (findMany.mock.calls[0][0] as { where: unknown }).where })
    expect(result.page).toBe(2)
    expect(result.totalPages).toBe(3) // ceil(45/20)
    expect(result.totalCount).toBe(45)
    expect(result.nextCursor).toBeNull()
  })

  it('page < 1 fällt auf Seite 1 zurück (skip 0)', async () => {
    await searchBeyblades({ page: 0 })
    const call = findMany.mock.calls[0][0] as { skip: number }
    expect(call.skip).toBe(0)
  })

  it('ohne page bleibt der Cursor-Zweig unverändert (page/totalPages/totalCount null)', async () => {
    const result = await searchBeyblades({ cursor: 'abc' })
    expect(result.page).toBeNull()
    expect(result.totalPages).toBeNull()
    expect(count).not.toHaveBeenCalled()
  })
})
