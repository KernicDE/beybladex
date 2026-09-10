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

function fakeBuild(id: string, bladeId: string, ratchetId: string, bitId: string) {
  return {
    id,
    bladeId,
    ratchetId,
    bitId,
    blade: { id: bladeId, name: `Blade ${bladeId}`, imageId: null, beyType: 'ATTACK' },
    ratchet: { id: ratchetId, name: `Ratchet ${ratchetId}` },
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

  it('skips the collection query entirely when onlyMine is off', async () => {
    buildFindMany.mockResolvedValue([fakeBuild('b1', 'p1', 'p2', 'p3')] as never)

    await searchBuilds({})

    expect(collectionFindMany).not.toHaveBeenCalled()
  })
})
