// tests/unit/search-parts-filters.test.ts (#137)
// Teile-Tab-Filter aus dem UX-Report: Typ, Drehrichtung, "nur im Besitz" — jeweils eine echte
// WHERE-Klausel (nicht in-memory), damit sie mit der cursor-Pagination zusammenspielen. Seams
// mocked on '@/lib/db', gleiches Muster wie tests/unit/build-search-mine.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    part: { findMany: vi.fn(), findUnique: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchParts } from '@/lib/buildSearch'

const partFindMany = vi.mocked(prisma.part.findMany)
const collectionFindMany = vi.mocked(prisma.collectionItem.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  partFindMany.mockResolvedValue([] as never)
  collectionFindMany.mockResolvedValue([] as never)
})

describe('searchParts type/spinDirection/ownedByUserId (#137)', () => {
  it('filtert per DB-Query auf beyType', async () => {
    await searchParts({ type: 'STAMINA' })
    const where = (partFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ beyType: 'STAMINA' })
  })

  it('filtert per DB-Query auf spinDirection', async () => {
    await searchParts({ spinDirection: 'LEFT' })
    const where = (partFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ spinDirection: 'LEFT' })
  })

  it('"nur im Besitz" lädt die eigenen Teile-IDs und filtert per id-in — kein in-memory-Filter', async () => {
    collectionFindMany.mockResolvedValueOnce([{ partOrBeyId: 'p1' }, { partOrBeyId: 'p2' }] as never)

    await searchParts({ ownedByUserId: 'user-1' })

    expect(collectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, select: { partOrBeyId: true }, distinct: ['partOrBeyId'] }),
    )
    const where = (partFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ id: { in: ['p1', 'p2'] } })
  })

  it('skips die CollectionItem-Query, wenn ownedByUserId nicht gesetzt ist', async () => {
    await searchParts({})
    expect(collectionFindMany).not.toHaveBeenCalled()
  })

  it('alle drei Filter kombinieren sich additiv in EINER Query', async () => {
    collectionFindMany.mockResolvedValueOnce([{ partOrBeyId: 'p1' }] as never)

    await searchParts({ type: 'ATTACK', spinDirection: 'RIGHT', ownedByUserId: 'user-1', category: 'BLADE' })

    const where = (partFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ beyType: 'ATTACK' })
    expect(where.AND).toContainEqual({ spinDirection: 'RIGHT' })
    expect(where.AND).toContainEqual({ id: { in: ['p1'] } })
    expect(where.AND).toContainEqual({ category: 'BLADE' })
  })
})
