// tests/unit/part-detail-page.test.tsx (RC16 #105)
// Die neue Einzelteil-Detailseite listet alle Builds, in denen das Teil vorkommt — der
// Rueckverweis muss OR ueber ALLE 7 Slot-FKs laufen (RC16 #122: CX-Builds ueber Lock Chip/
// Over/Metal/Assist Blade, Ratchet-Integrated ueber Blade + Bit). Seams auf '@/lib/db' und
// '@/lib/metaCache', kein echtes DB/Redis.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    part: { findUnique: vi.fn() },
    build: { findMany: vi.fn() },
    beyblade: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    rating: { findMany: vi.fn(), aggregate: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('@/lib/metaCache', () => ({
  getPartStats: vi.fn(async () => new Map([['p1', { appearances: 1, wins: 1, winRate: 1, decisiveMatches: 1 }]])),
  getBuildStats: vi.fn(async () => new Map()),
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  // MVP4 #143: die Seite rendert RatingList/RatingForm ('use client' — useRouter).
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import PartDetailPage from '@/app/parts/[id]/page'

const partFindUnique = vi.mocked(prisma.part.findUnique)
const buildFindMany = vi.mocked(prisma.build.findMany)
const beybladeFindMany = vi.mocked(prisma.beyblade.findMany)
const collectionItemFindMany = vi.mocked(prisma.collectionItem.findMany)
const mockAuth = vi.mocked(auth)

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
  // MVP4 #143: polymorphe Teil-Bewertung (findMany = Liste, aggregate = Header-Durchschnitt).
  vi.mocked(prisma.rating.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.rating.aggregate).mockResolvedValue({ _avg: { stars: null }, _count: 0 } as never)
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

    // Issue #187 — die Builds-Rückverweis-Query ist zusätzlich auf visibility=PUBLIC
    // eingeschränkt (öffentliche Katalogseite, kein Login nötig); Beyblades (offizielle Sets)
    // kennen keine Sichtbarkeit und bleiben beim reinen Occurrence-where.
    expect(buildFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [OCCURRENCE_WHERE, { visibility: 'PUBLIC' }] } }))
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

describe('PartDetailPage — "In meinen Beyblades" (#160)', () => {
  afterEach(() => mockAuth.mockReset())

  it('lädt die eigenen CollectionItem-Zeilen nur für angemeldete Nutzer:innen (Login-Gate)', async () => {
    partFindUnique.mockResolvedValue(PART as never)
    collectionItemFindMany.mockResolvedValue([] as never)

    // Nicht angemeldet (Default-Mock: auth() → null) — kein Query.
    await PartDetailPage({ params: Promise.resolve({ id: 'p1' }) } as never)
    expect(collectionItemFindMany).not.toHaveBeenCalled()

    // Angemeldet — Query läuft, scoped auf userId + partOrBeyId.
    mockAuth.mockResolvedValue({ user: { id: 'user-1' }, expires: new Date().toISOString() } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as never)
    await PartDetailPage({ params: Promise.resolve({ id: 'p1' }) } as never)
    expect(collectionItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', partOrBeyId: 'p1' } }),
    )
  })

  it('zeigt die Herkunft ("Aus <Beyblade>") bzw. "Einzeln hinzugefügt" ohne Herkunft', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    partFindUnique.mockResolvedValue(PART as never)
    mockAuth.mockResolvedValue({ user: { id: 'user-1' }, expires: new Date().toISOString() } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as never)
    collectionItemFindMany.mockResolvedValue([
      { id: 'ci1', purchasePrice: 19.99, currency: 'EUR', merchant: 'Testladen', boughtAt: null, sourceBeyblade: { id: 'bey1', name: 'Dranzer' } },
      { id: 'ci2', purchasePrice: null, currency: 'EUR', merchant: null, boughtAt: null, sourceBeyblade: null },
    ] as never)

    const html = renderToStaticMarkup(await PartDetailPage({ params: Promise.resolve({ id: 'p1' }) } as never))
    expect(html).toContain('In meinen Beyblades')
    expect(html).toContain('Dranzer')
    expect(html).toContain('Einzeln hinzugefügt')
  })
})
