// tests/unit/purchase-flow.test.ts (MVP4 #142)
// Kauf-Flow: parsePurchaseBody (Validierung), shapePriceHistory (Aggregat) und die vier
// Routen (POST /api/beyblades/[id]/purchases, PATCH+DELETE /api/purchases/[id],
// GET /api/merchants/suggest, GET /api/beyblades/[id]/price-history). Seam-Mocks auf
// '@/lib/auth', '@/lib/db', '@/lib/rateLimit' — kein echtes DB/Redis; die DB-gestuetzte
// Authz-Matrix bleibt der Integration-Suite ueberlassen.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock-Factories werden ABOVE der Deklaration gehoistet — die Spies muessen aus
// vi.hoisted() kommen, sonst TDZ ("Cannot access before initialization").
const { authMock, rateLimitMock, beybladeFindUnique, purchaseCreate, purchaseFindUnique, purchaseFindMany, purchaseUpdate, purchaseDelete } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    rateLimitMock: vi.fn(),
    beybladeFindUnique: vi.fn(),
    purchaseCreate: vi.fn(),
    purchaseFindUnique: vi.fn(),
    purchaseFindMany: vi.fn(),
    purchaseUpdate: vi.fn(),
    purchaseDelete: vi.fn(),
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

describe('POST /api/beyblades/[id]/purchases (#142)', () => {
  it('erstellt einen minimalen Kauf (201, Defaults merchant/boughtAt/price null, EUR)', async () => {
    beybladeFindUnique.mockResolvedValue({ id: 'b1' })
    purchaseCreate.mockResolvedValue({ id: 'p1' })

    const res = await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))

    expect(res.status).toBe(201)
    expect(purchaseCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        beybladeId: 'b1',
        merchant: null,
        boughtAt: null,
        price: null,
        currency: 'EUR',
      },
    })
  })

  it('persistiert Händler/Datum/Preis/Währung wenn gesetzt', async () => {
    beybladeFindUnique.mockResolvedValue({ id: 'b1' })
    purchaseCreate.mockResolvedValue({ id: 'p1' })

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
    const { data } = purchaseCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.merchant).toBe('Amazon.de')
    expect(data.price).toBe(24.99)
    expect(data.currency).toBe('USD')
    expect((data.boughtAt as Date).toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('lehnt fremde userId im Body ab — Owner kommt immer aus der Session', async () => {
    beybladeFindUnique.mockResolvedValue({ id: 'b1' })
    purchaseCreate.mockResolvedValue({ id: 'p1' })

    await POST_PURCHASE(
      jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', { userId: 'user-2' }),
      ctx('b1'),
    )

    expect(purchaseCreate.mock.calls[0]![0].data.userId).toBe('user-1')
  })

  it('unbekannte Beyblade → 404 ohne Purchase-Row', async () => {
    beybladeFindUnique.mockResolvedValue(null)
    const res = await POST_PURCHASE(jsonReq('http://localhost/api/beyblades/b1/purchases', 'POST', {}), ctx('b1'))
    expect(res.status).toBe(404)
    expect(purchaseCreate).not.toHaveBeenCalled()
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
