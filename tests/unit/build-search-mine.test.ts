// tests/unit/build-search-mine.test.ts (RC5 issue #58)
// "nur meine Teile" must load the owned-part id set as a narrow DISTINCT id query — never the
// full CollectionItem rows. Seams mocked on '@/' imports (lib/db), same pattern as
// tests/unit/notify-triggers.test.ts — no real database involved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    build: { findMany: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBuilds } from '@/lib/buildSearch'

const buildFindMany = vi.mocked(prisma.build.findMany)
const collectionFindMany = vi.mocked(prisma.collectionItem.findMany)

function fakeBuild(id: string, bladeId: string | null, ratchetId: string | null, bitId: string, extra: Partial<{ lockChipId: string; overBladeId: string; metalBladeId: string; assistBladeId: string }> = {}) {
  return {
    id,
    bladeId,
    ratchetId,
    bitId,
    lockChipId: extra.lockChipId ?? null,
    overBladeId: extra.overBladeId ?? null,
    metalBladeId: extra.metalBladeId ?? null,
    assistBladeId: extra.assistBladeId ?? null,
    blade: bladeId !== null ? { id: bladeId, name: `Blade ${bladeId}`, imageId: null, beyType: 'ATTACK' } : null,
    lockChip: extra.lockChipId ? { id: extra.lockChipId, name: `LockChip ${extra.lockChipId}` } : null,
    overBlade: extra.overBladeId ? { id: extra.overBladeId, name: `OverBlade ${extra.overBladeId}` } : null,
    metalBlade: extra.metalBladeId ? { id: extra.metalBladeId, name: `MetalBlade ${extra.metalBladeId}` } : null,
    assistBlade: extra.assistBladeId ? { id: extra.assistBladeId, name: `AssistBlade ${extra.assistBladeId}` } : null,
    ratchet: ratchetId !== null ? { id: ratchetId, name: `Ratchet ${ratchetId}` } : null,
    bit: { id: bitId, name: `Bit ${bitId}` },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('searchBuilds onlyMineUserId (issue #58)', () => {
  it('loads the owned-part set with select + distinct instead of full collection rows', async () => {
    buildFindMany.mockResolvedValue([fakeBuild('b1', 'p1', 'p2', 'p3')] as never)
    collectionFindMany.mockResolvedValue([{ partOrBeyId: 'p1' }] as never)

    await searchBuilds({ onlyMineUserId: 'user-1' })

    expect(collectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        select: { partOrBeyId: true },
        distinct: ['partOrBeyId'],
      })
    )
    // The id query must not drag the full CollectionItem columns (purchasePrice, merchant, …)
    // across the wire.
    const call = collectionFindMany.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(call)).toEqual(expect.arrayContaining(['where', 'select', 'distinct']))
  })

  it('keeps only builds whose ALL THREE parts are owned', async () => {
    buildFindMany.mockResolvedValue([
      fakeBuild('all-owned', 'p1', 'p2', 'p3'),
      fakeBuild('partial', 'p1', 'p9', 'p3'),
    ] as never)
    // Duplicate ownership rows (repeated purchases / set provenance) collapse via DISTINCT.
    collectionFindMany.mockResolvedValue([
      { partOrBeyId: 'p1' },
      { partOrBeyId: 'p1' },
      { partOrBeyId: 'p2' },
      { partOrBeyId: 'p3' },
    ] as never)

    const { builds } = await searchBuilds({ onlyMineUserId: 'user-1' })

    expect(builds.map((b) => b.id)).toEqual(['all-owned'])
  })

  it('RC16 (#122): Custom-Line-Builds brauchen alle SECHS Teile; Ratchet-Integrated nur Blade + Bit', async () => {
    buildFindMany.mockResolvedValue([
      // CX vollständig besitzt (p1–p6)
      fakeBuild('cx-owned', null, 'p5', 'p6', { lockChipId: 'p1', overBladeId: 'p2', metalBladeId: 'p3', assistBladeId: 'p4' }),
      // CX mit fehlendem Metal Blade
      fakeBuild('cx-missing', null, 'p5', 'p6', { lockChipId: 'p1', overBladeId: 'p2', metalBladeId: 'p9', assistBladeId: 'p4' }),
      // Ratchet-Integrated: kein Ratchet-Teil nötig
      fakeBuild('integrated-owned', 'p7', null, 'p8'),
      // Ratchet-Integrated ohne das Bit
      fakeBuild('integrated-missing', 'p7', null, 'p9'),
    ] as never)
    collectionFindMany.mockResolvedValue(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((partOrBeyId) => ({ partOrBeyId })) as never,
    )

    const { builds } = await searchBuilds({ onlyMineUserId: 'user-1' })

    expect(builds.map((b) => b.id)).toEqual(['cx-owned', 'integrated-owned'])
  })

  it('skips the collection query entirely when onlyMine is off', async () => {
    buildFindMany.mockResolvedValue([fakeBuild('b1', 'p1', 'p2', 'p3')] as never)

    await searchBuilds({})

    expect(collectionFindMany).not.toHaveBeenCalled()
  })
})
