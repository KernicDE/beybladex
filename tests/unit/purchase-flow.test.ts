// tests/unit/purchase-flow.test.ts (MVP4 #142)
// Kauf-Flow: parsePurchaseBody (Validierung), shapePriceHistory (Aggregat) und die vier
// Routen (POST /api/beyblades/[id]/purchases, PATCH+DELETE /api/purchases/[id],
// GET /api/merchants/suggest, GET /api/beyblades/[id]/price-history). Seam-Mocks auf
// '@/lib/auth', '@/lib/db', '@/lib/rateLimit' — kein echtes DB/Redis; die DB-gestuetzte
// Authz-Matrix bleibt der Integration-Suite ueberlassen.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock-Factories werden ABOVE der Deklaration gehoistet — die Spies muessen aus
// vi.hoisted() kommen, sonst TDZ ("Cannot access before initialization").
const {
  authMock,
  rateLimitMock,
  beybladeFindUnique,
  purchaseCreate,
  purchaseFindUnique,
  purchaseFindMany,
  purchaseUpdate,
  purchaseDelete,
  collectionItemCreate,
  transactionMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
  beybladeFindUnique: vi.fn(),
  purchaseCreate: vi.fn(),
  purchaseFindUnique: vi.fn(),
  purchaseFindMany: vi.fn(),
  purchaseUpdate: vi.fn(),
  purchaseDelete: vi.fn(),
  collectionItemCreate: vi.fn(),
  // #137-Nachtrag — createBeybladePurchase (lib/beybladePurchase.ts) baut die Purchase- und
  // CollectionItem-create-Aufrufe zu einem Array und übergibt es an $transaction; Promise.all
  // reicht als Fake, solange die einzelnen create-Mocks brauchbare Werte zurückgeben.
  transactionMock: vi.fn((ops: unknown[]) => Promise.all(ops)),
}))

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimitMock(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    beyblade: { findUnique: (...a: unknown[]) => beybladeFindUnique(...a) },
    purchase: {
      create: (...a: unknown[]) => purchaseCreate(...a),
      findUnique: (...a: unknown[]) => purchaseFindUnique(...a),
      findMany: (...a: unknown[]) => purchaseFindMany(...a),
      update: (...a: unknown[]) => purchaseUpdate(...a),
      delete: (...a: unknown[]) => purchaseDelete(...a),
    },
    collectionItem: { create: (...a: unknown[]) => collectionItemCreate(...a) },
    $transaction: (...a: unknown[]) => transactionMock(...(a as [unknown[]])),
  },
}))

import { POST as POST_PURCHASE } from '@/app/api/beyblades/[id]/purchases/route'
import { PATCH as PATCH_PURCHASE, DELETE as DELETE_PURCHASE } from '@/app/api/purchases/[id]/route'
import { GET as GET_MERCHANTS } from '@/app/api/merchants/suggest/route'
import { GET as GET_PRICE_HISTORY } from '@/app/api/beyblades/[id]/price-history/route'
import { parsePurchaseBody } from '@/lib/purchaseInput'
import { shapePriceHistory } from '@/lib/purchasePriceHistory'

function asUser() {
  authMock.mockResolvedValue({ user: { id: 'user-1' } })
}
function asGuest() {
  authMock.mockResolvedValue(null)
}
function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

// #137-Nachtrag — realistische Beyblade-Select-Form (alle 7 Slot-Spalten explizit, wie Prisma
// sie liefert — nie `undefined`). Standard-Bauform: Blade + Ratchet + Bit.
function fullBeyblade(id: string, overrides: Partial<Record<'bladeId' | 'lockChipId' | 'overBladeId' | 'metalBladeId' | 'assistBladeId' | 'ratchetId' | 'bitId', string | null>> = {}) {
  return {
    id,
    bladeId: 'p-blade',
    lockChipId: null,
    overBladeId: null,
    metalBladeId: null,
    assistBladeId: null,
    ratchetId: 'p-ratchet',
    bitId: 'p-bit',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser()
  rateLimitMock.mockResolvedValue({ allowed: true })
})

describe('parsePurchaseBody (#142)', () => {
  it('akzeptiert den leeren Body (alle Angaben optional)', () => {
    const parsed = parsePurchaseBody({})
    expect(parsed.error).toBeUndefined()
    expect(parsed.fields).toEqual({})
  })

  it('rundet den Preis auf zwei Stellen und akzeptiert numerische Strings', () => {
    const parsed = parsePurchaseBody({ price: '19.999', currency: 'CHF' })
    expect(parsed.fields).toMatchObject({ price: 20, currency: 'CHF' })
  })

  it('lehnt negative Preise ab (invalid_price)', () => {
    expect(parsePurchaseBody({ price: -1 }).error).toBe('invalid_price')
  })

  it('lehnt unbekannte Währungen ab (invalid_currency)', () => {
    expect(parsePurchaseBody({ currency: 'GBP' }).error).toBe('invalid_currency')
  })

  it('lehnt Kaufdaten weit in der Zukunft ab (invalid_boughtAt), erlaubt aber heute', () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(parsePurchaseBody({ boughtAt: future }).error).toBe('invalid_boughtAt')
    const today = new Date().toISOString()
    expect(parsePurchaseBody({ boughtAt: today }).error).toBeUndefined()
  })

  it('degradiert all-whitespace Händler zu null und trimmt sonst', () => {
    expect(parsePurchaseBody({ merchant: '   ' }).fields?.merchant).toBeNull()
    expect(parsePurchaseBody({ merchant: '  Amazon.de ' }).fields?.merchant).toBe('Amazon.de')
  })
})

describe('shapePriceHistory (#142)', () => {
  it('gruppiert nach Währung, sortiert chronologisch, nutzt boughtAt ?? createdAt', () => {
    const rows = [
      { price: 25, currency: 'EUR', boughtAt: new Date('2026-03-01'), createdAt: new Date('2026-03-02') },
      { price: 20, currency: 'EUR', boughtAt: null, createdAt: new Date('2026-01-15') },
      { price: 27.5, currency: 'CHF', boughtAt: null, createdAt: new Date('2026-02-01') },
      { price: null, currency: 'EUR', boughtAt: null, createdAt: new Date('2026-01-01') },
    ]
    const series = shapePriceHistory(rows)
    expect(Object.keys(series).sort()).toEqual(['CHF', 'EUR'])
    expect(series.EUR!.map((p) => p.price)).toEqual([20, 25])
    // 20er-Punkt ohne Kaufdatum zählt ab Meldedatum, kommt also vor dem März-Punkt.
    expect(series.EUR![0]!.date).toEqual(new Date('2026-01-15'))
    expect(series.CHF![0]!.price).toBe(27.5)
  })
})

describe('POST /api/beyblades/[id]/purchases (#142; #137-Nachtrag — schreibt jetzt auch CollectionItem-Provenienz)', () => {
  it('erstellt einen minimalen Kauf (201, Defaults merchant/boughtAt/price null, EUR) UND je belegtem Slot eine CollectionItem-Row', async () => {
    beybladeFindUnique.mockResolvedValue(fullBeyblade('b1'))
    purchaseCreate.mockResolvedValue({ id: 'p1' })
    collectionItemCreate.mockImplementation((args: { data: { partOrBeyId: string } }) => ({ id: `ci-${args.data.partOrBeyId}` }))

    const res = await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))

    expect(res.status).toBe(201)
    const body = (await res.json()) as { purchaseId: string; itemIds: string[] }
    expect(body.purchaseId).toBe('p1')
    // #137-Nachtrag — DIES ist die Regression: vorher blieb itemIds leer (keine CollectionItem-
    // Provenienz), "Mein Inventar" zeigte einen gerade gekauften Beyblade trotzdem nicht an.
    expect(body.itemIds).toHaveLength(3) // Standard-Bauform: Blade, Ratchet, Bit

    expect(purchaseCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', beybladeId: 'b1', merchant: null, boughtAt: null, price: null, currency: 'EUR' },
      select: { id: true },
    })
    expect(collectionItemCreate).toHaveBeenCalledTimes(3)
    for (const partOrBeyId of ['p-blade', 'p-ratchet', 'p-bit']) {
      expect(collectionItemCreate).toHaveBeenCalledWith({
        data: { userId: 'user-1', partOrBeyId, sourceBeybladeId: 'b1', purchasePrice: null, currency: 'EUR', merchant: null, boughtAt: null },
        select: { id: true },
      })
    }
  })

  it('persistiert Händler/Datum/Preis/Währung an Purchase UND jeder CollectionItem-Row', async () => {
    beybladeFindUnique.mockResolvedValue(fullBeyblade('b1'))
    purchaseCreate.mockResolvedValue({ id: 'p1' })
    collectionItemCreate.mockResolvedValue({ id: 'ci1' })

    const res = await POST_PURCHASE(
      jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {
        merchant: 'Amazon.de',
        boughtAt: '2026-09-01',
        price: 24.99,
        currency: 'USD',
      }),
      ctx('b1'),
    )

    expect(res.status).toBe(201)
    const { data: purchaseData } = purchaseCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(purchaseData.merchant).toBe('Amazon.de')
    expect(purchaseData.price).toBe(24.99)
    expect(purchaseData.currency).toBe('USD')
    expect((purchaseData.boughtAt as Date).toISOString().slice(0, 10)).toBe('2026-09-01')

    const { data: itemData } = collectionItemCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(itemData.merchant).toBe('Amazon.de')
    expect(itemData.purchasePrice).toBe(24.99)
    expect(itemData.currency).toBe('USD')
  })

  it('Ratchet-Integrated (kein Ratchet-Teil): nur 2 CollectionItem-Rows (Blade, Bit)', async () => {
    beybladeFindUnique.mockResolvedValue(fullBeyblade('b1', { ratchetId: null }))
    purchaseCreate.mockResolvedValue({ id: 'p1' })
    collectionItemCreate.mockResolvedValue({ id: 'ci' })

    const res = await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))

    expect(res.status).toBe(201)
    expect(collectionItemCreate).toHaveBeenCalledTimes(2)
  })

  it('lehnt fremde userId im Body ab — Owner kommt immer aus der Session', async () => {
    beybladeFindUnique.mockResolvedValue(fullBeyblade('b1'))
    purchaseCreate.mockResolvedValue({ id: 'p1' })
    collectionItemCreate.mockResolvedValue({ id: 'ci' })

    await POST_PURCHASE(
      jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', { userId: 'user-2' }),
      ctx('b1'),
    )

    expect(purchaseCreate.mock.calls[0]![0].data.userId).toBe('user-1')
    expect(collectionItemCreate.mock.calls[0]![0].data.userId).toBe('user-1')
  })

  it('unbekannte Beyblade → 404 ohne Purchase- oder CollectionItem-Row', async () => {
    beybladeFindUnique.mockResolvedValue(null)
    const res = await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))
    expect(res.status).toBe(404)
    expect(purchaseCreate).not.toHaveBeenCalled()
    expect(collectionItemCreate).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('ungültiger Preis → 400, kein DB-Write', async () => {
    const res = await POST_PURCHASE(
      jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', { price: -5 }),
      ctx('b1'),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_price' })
    expect(beybladeFindUnique).not.toHaveBeenCalled()
  })

  it('Gast → 401, Rate-Limit → 429', async () => {
    asGuest()
    expect((await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))).status).toBe(401)

    asUser()
    rateLimitMock.mockResolvedValue({ allowed: false })
    expect((await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))).status).toBe(429)
    expect(purchaseCreate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/purchases/[id] (#142)', () => {
  it('editiert Händler/Datum/Preis/Währung des eigenen Kaufs', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-1' })

    const res = await PATCH_PURCHASE(
      jsonReq('http://localhost/api/purchases/p1', 'PATCH', { merchant: 'Toys R Us', price: 19.95 }),
      ctx('p1'),
    )

    expect(res.status).toBe(200)
    expect(purchaseUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { merchant: 'Toys R Us', price: 19.95 },
    })
  })

  it('berücksichtigt explizites null (Angabe entfernen)', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-1' })

    const res = await PATCH_PURCHASE(
      jsonReq('http://localhost/api/purchases/p1', 'PATCH', { merchant: null, price: null }),
      ctx('p1'),
    )

    expect(res.status).toBe(200)
    expect(purchaseUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { merchant: null, price: null },
    })
  })

  it('fremder Kauf → 404 (Existenz wird nicht geleakt), Gast → 401', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-2' })
    expect((await PATCH_PURCHASE(jsonReq('http://localhost/api/purchases/p1', 'PATCH', { price: 1 }), ctx('p1'))).status).toBe(404)
    expect(purchaseUpdate).not.toHaveBeenCalled()

    asGuest()
    expect((await PATCH_PURCHASE(jsonReq('http://localhost/api/purchases/p1', 'PATCH', { price: 1 }), ctx('p1'))).status).toBe(401)
  })

  it('unbekannte Währung → 400 ohne DB-Write', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-1' })
    const res = await PATCH_PURCHASE(jsonReq('http://localhost/api/purchases/p1', 'PATCH', { currency: 'JPY' }), ctx('p1'))
    expect(res.status).toBe(400)
    expect(purchaseUpdate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/purchases/[id] (#142)', () => {
  it('löscht den eigenen Kauf', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-1' })

    const res = await DELETE_PURCHASE(new Request('http://localhost/api/purchases/p1', { method: 'DELETE' }), ctx('p1'))

    expect(res.status).toBe(200)
    expect(purchaseDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('fremder Kauf → 404, Gast → 401, kein DB-Delete', async () => {
    purchaseFindUnique.mockResolvedValue({ id: 'p1', userId: 'user-2' })
    expect((await DELETE_PURCHASE(new Request('http://localhost/api/purchases/p1', { method: 'DELETE' }), ctx('p1'))).status).toBe(404)

    asGuest()
    expect((await DELETE_PURCHASE(new Request('http://localhost/api/purchases/p1', { method: 'DELETE' }), ctx('p1'))).status).toBe(401)
    expect(purchaseDelete).not.toHaveBeenCalled()
  })
})

describe('GET /api/merchants/suggest (#142)', () => {
  it('liefert DISTINCT-Händler (Prefix-Match, LIMIT 8) als String-Liste', async () => {
    purchaseFindMany.mockResolvedValue([
      { merchant: 'Amazon.de' },
      { merchant: 'Amazon.fr' },
      { merchant: null },
    ])

    const res = await GET_MERCHANTS(new Request('http://localhost/api/merchants/suggest?q=Ama'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.merchants).toEqual(['Amazon.de', 'Amazon.fr'])
    expect(purchaseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchant: { startsWith: 'Ama', mode: 'insensitive' } },
        distinct: ['merchant'],
        take: 8,
      }),
    )
  })

  it('zu kurze Query (<3 Zeichen) → 400 invalid_query', async () => {
    const res = await GET_MERCHANTS(new Request('http://localhost/api/merchants/suggest?q=Am'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_query' })
    expect(purchaseFindMany).not.toHaveBeenCalled()
  })

  it('Gast → 401, Rate-Limit → 429', async () => {
    asGuest()
    expect((await GET_MERCHANTS(new Request('http://localhost/api/merchants/suggest?q=Ama'))).status).toBe(401)

    asUser()
    rateLimitMock.mockResolvedValue({ allowed: false })
    expect((await GET_MERCHANTS(new Request('http://localhost/api/merchants/suggest?q=Ama'))).status).toBe(429)
  })
})

describe('GET /api/beyblades/[id]/price-history (#142)', () => {
  it('liefert Punkte-Listen pro Währung (ISO-Daten, chronologisch)', async () => {
    beybladeFindUnique.mockResolvedValue({ id: 'b1' })
    purchaseFindMany.mockResolvedValue([
      { price: 25, currency: 'EUR', boughtAt: new Date('2026-03-01T00:00:00.000Z'), createdAt: new Date('2026-03-02T00:00:00.000Z') },
      { price: 20, currency: 'EUR', boughtAt: null, createdAt: new Date('2026-01-15T00:00:00.000Z') },
    ])

    const res = await GET_PRICE_HISTORY(new Request('http://localhost/api/beyblades/b1/price-history'), ctx('b1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.series.EUR).toEqual([
      { price: 20, date: '2026-01-15T00:00:00.000Z' },
      { price: 25, date: '2026-03-01T00:00:00.000Z' },
    ])
  })

  it('unbekannte Beyblade → 404', async () => {
    beybladeFindUnique.mockResolvedValue(null)
    const res = await GET_PRICE_HISTORY(new Request('http://localhost/api/beyblades/b1/price-history'), ctx('b1'))
    expect(res.status).toBe(404)
    expect(purchaseFindMany).not.toHaveBeenCalled()
  })
})
