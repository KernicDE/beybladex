// tests/unit/build-search-public.test.ts (MVP4/4, #144)
// Öffentliche-Builds-Ansicht: publicOnly filtert visibility=PUBLIC, der Typ-Filter nutzt die
// Build.type-Spalte, die Karten tragen den Ersteller (creator-Include) und die Teile-Gruppierung
// für den Teile-Tab folgt der kanonischen Kategorie-Ordnung. Seams mocked on '@/' imports
// (lib/db), same pattern as tests/unit/build-search-mine.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    build: { findMany: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBuilds, groupPartsByCategory, PART_CATEGORY_ORDER } from '@/lib/buildSearch'

const buildFindMany = vi.mocked(prisma.build.findMany)
const collectionFindMany = vi.mocked(prisma.collectionItem.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  buildFindMany.mockResolvedValue([] as never)
  collectionFindMany.mockResolvedValue([] as never)
})

describe('searchBuilds publicOnly (#144)', () => {
  it('restricts the listing to visibility=PUBLIC', async () => {
    await searchBuilds({ publicOnly: true })
    const where = (buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ visibility: 'PUBLIC' })
  })

  it('filters by the Build.type column', async () => {
    await searchBuilds({ publicOnly: true, type: 'STAMINA' })
    const where = (buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ type: 'STAMINA' })
  })

  it('adds neither clause for the private "Meine Builds" view', async () => {
    await searchBuilds({ onlyMineUserId: 'user-1' })
    const where = (buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toEqual([])
  })

  it('includes the creator username for the public cards', async () => {
    await searchBuilds({ publicOnly: true })
    const args = buildFindMany.mock.calls[0][0] as { include: Record<string, unknown> }
    expect(args.include.creator).toEqual({ select: { username: true } })
  })
})

describe('groupPartsByCategory (#144)', () => {
  it('groups in the canonical category order and drops empty groups', () => {
    const parts = [
      { id: 'p1', category: 'BIT' },
      { id: 'p2', category: 'BLADE' },
      { id: 'p3', category: 'BIT' },
    ]
    const groups = groupPartsByCategory(parts)
    expect(groups.map((g) => g.category)).toEqual(['BLADE', 'BIT'])
    expect(groups[0]!.parts.map((p) => p.id)).toEqual(['p2'])
    expect(groups[1]!.parts.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('keeps unknown categories at the end without crashing', () => {
    const groups = groupPartsByCategory([{ id: 'p1', category: 'FUTURE_KIND' }])
    expect(groups).toEqual([{ category: 'FUTURE_KIND', parts: [{ id: 'p1', category: 'FUTURE_KIND' }] }])
  })

  it('covers every PartCategory enum value exactly once', () => {
    const uniq = new Set(PART_CATEGORY_ORDER)
    expect(uniq.size).toBe(PART_CATEGORY_ORDER.length)
    for (const c of ['BLADE', 'RATCHET', 'BIT', 'ACCESSORY', 'LOCK_CHIP', 'OVER_BLADE', 'METAL_BLADE', 'ASSIST_BLADE']) {
      expect(uniq.has(c as (typeof PART_CATEGORY_ORDER)[number])).toBe(true)
    }
  })
})
