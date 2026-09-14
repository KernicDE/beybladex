// tests/unit/build-search-public.test.ts (MVP4/4, #144)
// Öffentliche-Builds-Ansicht: publicOnly filtert visibility=PUBLIC, der Typ-Filter nutzt die
// Build.type-Spalte, die Karten tragen den Ersteller (creator-Include) und die Teile-Gruppierung
// für den Teile-Tab folgt der kanonischen Kategorie-Ordnung. Seams mocked on '@/' imports
// (lib/db), same pattern as tests/unit/build-search-mine.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    build: { findMany: vi.fn(), count: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBuilds, groupPartsByCategory, PART_CATEGORY_ORDER } from '@/lib/buildSearch'

const buildFindMany = vi.mocked(prisma.build.findMany)
const buildCount = vi.mocked(prisma.build.count)
const collectionFindMany = vi.mocked(prisma.collectionItem.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  buildFindMany.mockResolvedValue([] as never)
  buildCount.mockResolvedValue(0 as never)
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

describe('searchBuilds creatorId (#153 — "Meine Builds" muss Ersteller:innen-Filter, nicht Teile-Besitz sein)', () => {
  it('filtert per DB-Query auf Build.creatorId — kein in-memory-Filter über die Sammlung', async () => {
    await searchBuilds({ creatorId: 'user-1' })
    const where = (buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ creatorId: 'user-1' })
    // Der Regression aus #153: ein frisch erstellter Build (Teile ggf. noch nicht "im Besitz"
    // markiert) darf NICHT über die CollectionItem-Verfügbarkeitsprüfung ausgefiltert werden.
    expect(collectionFindMany).not.toHaveBeenCalled()
  })

  it('creatorId und onlyMineUserId (Teile-Besitz) sind unabhängige Filter, beide gleichzeitig anwendbar', async () => {
    buildFindMany.mockResolvedValueOnce([
      { id: 'b1', creatorId: 'user-1', bladeId: 'p1', ratchetId: 'p2', bitId: 'p3', lockChipId: null, overBladeId: null, metalBladeId: null, assistBladeId: null, blade: null, lockChip: null, overBlade: null, metalBlade: null, assistBlade: null, ratchet: null, bit: null },
    ] as never)
    collectionFindMany.mockResolvedValueOnce([{ partOrBeyId: 'p1' }, { partOrBeyId: 'p2' }, { partOrBeyId: 'p3' }] as never)

    await searchBuilds({ creatorId: 'user-1', onlyMineUserId: 'user-1' })
    const where = (buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }).where
    expect(where.AND).toContainEqual({ creatorId: 'user-1' })
    expect(collectionFindMany).toHaveBeenCalled()
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

describe('searchBuilds page (#155 — echte Seitenzahlen)', () => {
  it('nutzt skip/take + COUNT statt Cursor, kombiniert mit creatorId/publicOnly/type', async () => {
    buildCount.mockResolvedValueOnce(41 as never)
    const result = await searchBuilds({ page: 3, take: 20, publicOnly: true, type: 'STAMINA' })

    const call = buildFindMany.mock.calls[0][0] as { skip: number; take: number; cursor?: unknown }
    expect(call.skip).toBe(40)
    expect(call.take).toBe(20)
    expect(call.cursor).toBeUndefined()
    expect(buildCount).toHaveBeenCalledWith({ where: (buildFindMany.mock.calls[0][0] as { where: unknown }).where })
    expect(result.page).toBe(3)
    expect(result.totalPages).toBe(3) // ceil(41/20)
    expect(collectionFindMany).not.toHaveBeenCalled()
  })

  it('page wird IGNORIERT, wenn onlyMineUserId gesetzt ist (in-memory-Filter kann keine korrekte Gesamtzahl liefern)', async () => {
    const result = await searchBuilds({ page: 2, onlyMineUserId: 'user-1' })
    expect(buildCount).not.toHaveBeenCalled()
    expect(result.page).toBeNull()
  })
})
