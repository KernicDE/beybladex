// tests/unit/part-detail-page.test.tsx (RC16 #105)
// Die neue Einzelteil-Detailseite listet alle Builds, in denen das Teil vorkommt — der
// Rueckverweis muss OR ueber ALLE 7 Slot-FKs laufen (RC16 #122: CX-Builds ueber Lock Chip/
// Over/Metal/Assist Blade, Ratchet-Integrated ueber Blade + Bit). Seams auf '@/lib/db' und
// '@/lib/metaCache', kein echtes DB/Redis.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    part: { findUnique: vi.fn() },
    build: { findMany: vi.fn() },
    beyblade: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('@/lib/metaCache', () => ({
  getPartStats: vi.fn(async () => new Map([['p1', { appearances: 1, wins: 1, winRate: 1, decisiveMatches: 1 }]])),
  getBuildStats: vi.fn(async () => new Map()),
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

import { prisma } from '@/lib/db'
import PartDetailPage from '@/app/parts/[id]/page'

const partFindUnique = vi.mocked(prisma.part.findUnique)
const buildFindMany = vi.mocked(prisma.build.findMany)
const beybladeFindMany = vi.mocked(prisma.beyblade.findMany)

const PART = {
  id: 'p1',
  name: 'Flat',
  manufacturer: 'TT',
  category: 'BIT',
  beyType: 'ATTACK',
  spinDirection: 'RIGHT',
  dualSpin: false,
  isRatchetIntegrated: false,
  weightGrams: 2.1,
  imageId: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  buildFindMany.mockResolvedValue([] as never)
  beybladeFindMany.mockResolvedValue([] as never)
})

describe('PartDetailPage (issue #105; MVP4 #141 — Beyblades UND Builds)', () => {
  const OCCURRENCE_WHERE = {
    OR: [
      { bladeId: 'p1' },
      { lockChipId: 'p1' },
      { overBladeId: 'p1' },
      { metalBladeId: 'p1' },
      { assistBladeId: 'p1' },
      { ratchetId: 'p1' },
      { bitId: 'p1' },
    ],
  }

  it('sucht Builds UND Beyblades OR ueber alle 7 Slot-FKs (dasselbe Occurrence-where)', async () => {
    partFindUnique.mockResolvedValue(PART as never)

    await PartDetailPage({ params: Promise.resolve({ id: 'p1' }) } as never)

    expect(buildFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: OCCURRENCE_WHERE }))
    expect(beybladeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: OCCURRENCE_WHERE }))
  })

  it('rendert Bits als „Kurzcode (Vollname)" (#106) und 404t bei unbekanntem Teil', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    partFindUnique.mockResolvedValue(PART as never)
    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ id: 'p1' }) } as never))
    expect(html).toContain('F (Flat)')

    partFindUnique.mockResolvedValue(null as never)
    await expect(PartDetailPage({ params: Promise.resolve({ id: 'nix' }) } as never)).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
