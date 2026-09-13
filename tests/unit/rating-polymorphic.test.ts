// tests/unit/rating-polymorphic.test.ts (MVP4 #143)
// Polymorphe Bewertungen: parseRatingBody (Validierung), shapeRatingAggregate(s) (reine
// Aggregate — Einzel- + Batch-Variante für #144) und die generische Route
// app/api/ratings/route.ts (GET/POST/PATCH/PUT/DELETE über targetType+targetId). Seam-Mocks
// auf '@/lib/auth', '@/lib/db', '@/lib/rateLimit' — kein echtes DB/Redis; die DB-gestützte
// Authz-Matrix (inkl. Legacy-Pfad /api/builds/[id]/ratings) bleibt der Integration-Suite.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock-Factories werden ABOVE der Deklaration gehoistet — die Spies muessen aus
// vi.hoisted() kommen, sonst TDZ ("Cannot access before initialization").
const {
  authMock,
  rateLimitMock,
  beybladeFindUnique,
  buildFindUnique,
  partFindUnique,
  ratingFindMany,
  ratingFindUnique,
  ratingUpsert,
  ratingUpdate,
  ratingDelete,
  ratingAggregate,
  ratingGroupBy,
  userFindUnique,
  txRatingDelete,
  txAuditLogCreate,
  transactionMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
  beybladeFindUnique: vi.fn(),
  buildFindUnique: vi.fn(),
  partFindUnique: vi.fn(),
  ratingFindMany: vi.fn(),
  ratingFindUnique: vi.fn(),
  ratingUpsert: vi.fn(),
  ratingUpdate: vi.fn(),
  ratingDelete: vi.fn(),
  ratingAggregate: vi.fn(),
  ratingGroupBy: vi.fn(),
  userFindUnique: vi.fn(),
  txRatingDelete: vi.fn(),
  txAuditLogCreate: vi.fn(),
  transactionMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimitMock(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    // lib/ratingTarget.ts-Seam: Existenzprüfung des polymorphen Ziels.
    beyblade: { findUnique: (...a: unknown[]) => beybladeFindUnique(...a) },
    build: { findUnique: (...a: unknown[]) => buildFindUnique(...a) },
    part: { findUnique: (...a: unknown[]) => partFindUnique(...a) },
    rating: {
      findMany: (...a: unknown[]) => ratingFindMany(...a),
      findUnique: (...a: unknown[]) => ratingFindUnique(...a),
      upsert: (...a: unknown[]) => ratingUpsert(...a),
      update: (...a: unknown[]) => ratingUpdate(...a),
      delete: (...a: unknown[]) => ratingDelete(...a),
      aggregate: (...a: unknown[]) => ratingAggregate(...a),
      groupBy: (...a: unknown[]) => ratingGroupBy(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}))

import { GET, POST, PATCH, PUT, DELETE } from '@/app/api/ratings/route'
import { parseRatingBody } from '@/lib/ratingInput'
import { shapeRatingAggregate, shapeRatingAggregates, EMPTY_RATING_AGGREGATE } from '@/lib/ratingAggregate'

function asUser(id = 'user-1') {
  authMock.mockResolvedValue({ user: { id }, expires: new Date(Date.now() + 86400_000).toISOString() })
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

/** targetType=PART + existierendes Teil-Default; pro Test übersteuerbar. */
function targetExists() {
  partFindUnique.mockResolvedValue({ id: 'p1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser()
  rateLimitMock.mockResolvedValue({ allowed: true })
  targetExists()
  transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ rating: { delete: txRatingDelete }, auditLog: { create: txAuditLogCreate } }),
  )
})

describe('parseRatingBody (#143)', () => {
  it('akzeptiert Sterne 1–5 mit optionalem Kommentar', () => {
    expect(parseRatingBody({ stars: 1, comment: null })).toEqual({ stars: 1, comment: null })
    expect(parseRatingBody({ stars: 5, comment: '  Top  ' })).toEqual({ stars: 5, comment: 'Top' })
  })

  it('lehnt ungültige Sterne ab (0, 6, nicht ganzzahlig, String)', () => {
    for (const stars of [0, 6, 3.5, '4']) {
      expect(parseRatingBody({ stars }).errors).toContain('invalid_stars')
    }
  })

  it('lehnt Nicht-String-Kommentare ab und all-whitespace wird zu null', () => {
    expect(parseRatingBody({ stars: 4, comment: 7 }).errors).toContain('invalid_comment')
    expect(parseRatingBody({ stars: 4, comment: '   ' }).comment).toBeNull()
  })

  it('lehnt einen nicht-objekt Body ab (invalid_body)', () => {
    expect(parseRatingBody(null).errors).toEqual(['invalid_body'])
    expect(parseRatingBody('stars').errors).toEqual(['invalid_body'])
  })
})

describe('shapeRatingAggregate / shapeRatingAggregates (#143)', () => {
  it('leeres/null Row → { avg: null, count: 0 }', () => {
    expect(shapeRatingAggregate(null)).toEqual(EMPTY_RATING_AGGREGATE)
    expect(shapeRatingAggregate(undefined)).toEqual({ avg: null, count: 0 })
    expect(shapeRatingAggregate({ _avg: { stars: null }, _count: 0 })).toEqual({ avg: null, count: 0 })
  })

  it('rechnet Durchschnitt und Anzahl unverändert durch (kein Runden — Anzeige-Sache)', () => {
    expect(shapeRatingAggregate({ _avg: { stars: 4.333333 }, _count: 3 })).toEqual({ avg: 4.333333, count: 3 })
  })

  it('Batch: mappt groupBy-Zeilen nach targetId; Ziele ohne Bewertung fehlen (Caller-Default)', () => {
    const map = shapeRatingAggregates([
      { targetId: 'b1', _avg: { stars: 4 }, _count: 2 },
      { targetId: 'b2', _avg: { stars: 2.5 }, _count: 4 },
    ])
    expect(map.get('b1')).toEqual({ avg: 4, count: 2 })
    expect(map.get('b2')).toEqual({ avg: 2.5, count: 4 })
    expect(map.has('b3')).toBe(false)
    expect(map.get('b3') ?? EMPTY_RATING_AGGREGATE).toEqual({ avg: null, count: 0 })
  })
})

describe('GET /api/ratings (#143)', () => {
  it('listet Bewertungen des Ziels öffentlich (username, ISO-Datum, nextCursor null)', async () => {
    ratingFindMany.mockResolvedValue([
      { id: 'r1', stars: 5, comment: null, createdAt: new Date('2026-09-10T00:00:00.000Z'), user: { username: 'kai' } },
    ])

    const res = await GET(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ratings).toEqual([
      { id: 'r1', stars: 5, comment: null, createdAt: '2026-09-10T00:00:00.000Z', username: 'kai' },
    ])
    expect(body.nextCursor).toBeNull()
    expect(ratingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetType: 'PART', targetId: 'p1' } }),
    )
  })

  it('ungültiger targetType / fehlende targetId → 400, unbekanntes Ziel → 404', async () => {
    expect((await GET(new Request('http://localhost/api/ratings?targetType=X&targetId=p1'))).status).toBe(400)
    expect((await GET(new Request('http://localhost/api/ratings?targetType=PART'))).status).toBe(400)

    partFindUnique.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1'))).status).toBe(404)
    expect(ratingFindMany).not.toHaveBeenCalled()
  })

  it('polymorphe Existenzprüfung je targetType (Beyblade/Build-Modell statt Part)', async () => {
    beybladeFindUnique.mockResolvedValue({ id: 'bb1' })
    ratingFindMany.mockResolvedValue([])

    await GET(new Request('http://localhost/api/ratings?targetType=BEYBLADE&targetId=bb1'))
    expect(beybladeFindUnique).toHaveBeenCalledWith({ where: { id: 'bb1' }, select: { id: true } })
    expect(partFindUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/ratings (#143)', () => {
  it('upserted via @@unique (zweites POST editiert) und gibt 201 zurück', async () => {
    ratingUpsert.mockResolvedValue({ id: 'r1' })

    const res = await POST(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'POST', { stars: 4, comment: 'Griffig' }))

    expect(res.status).toBe(201)
    expect(ratingUpsert).toHaveBeenCalledWith({
      where: { targetType_targetId_userId: { targetType: 'PART', targetId: 'p1', userId: 'user-1' } },
      create: { targetType: 'PART', targetId: 'p1', userId: 'user-1', stars: 4, comment: 'Griffig' },
      update: { stars: 4, comment: 'Griffig' },
    })
  })

  it('unbekanntes Ziel → 404 ohne Upsert; ungültiger targetType → 400', async () => {
    partFindUnique.mockResolvedValue(null)
    expect((await POST(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'POST', { stars: 3 }))).status).toBe(404)
    expect(ratingUpsert).not.toHaveBeenCalled()

    expect((await POST(jsonReq('http://localhost/api/ratings?targetType=X&targetId=p1', 'POST', { stars: 3 }))).status).toBe(400)
  })

  it('ungültige Sterne → 400, Gast → 401, Rate-Limit → 429 — kein Upsert', async () => {
    expect((await POST(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'POST', { stars: 9 }))).status).toBe(400)

    asGuest()
    expect((await POST(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'POST', { stars: 3 }))).status).toBe(401)

    asUser()
    rateLimitMock.mockResolvedValue({ allowed: false })
    expect((await POST(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'POST', { stars: 3 }))).status).toBe(429)
    expect(ratingUpsert).not.toHaveBeenCalled()
  })
})

describe('PATCH / PUT /api/ratings (#143)', () => {
  const RATING = { id: 'r1', userId: 'user-1', targetType: 'PART', targetId: 'p1' }

  it('editiert die eigene Bewertung (Sterne + Kommentar wie das Formular sie schickt)', async () => {
    ratingFindUnique.mockResolvedValue(RATING)

    const res = await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PATCH', { stars: 5, comment: 'Update' }))

    expect(res.status).toBe(200)
    expect(ratingUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { stars: 5, comment: 'Update' } })
  })

  it('Sterne sind Pflicht im Patch-Body (Kommentar-only → 400 invalid_stars)', async () => {
    ratingFindUnique.mockResolvedValue(RATING)

    const res = await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PATCH', { comment: 'Update' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_stars' })
    expect(ratingUpdate).not.toHaveBeenCalled()
  })

  it('PUT ist ein Alias von PATCH (volle Feld-Menge)', async () => {
    ratingFindUnique.mockResolvedValue(RATING)

    const res = await PUT(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PUT', { stars: 2, comment: null }))

    expect(res.status).toBe(200)
    expect(ratingUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { stars: 2, comment: null } })
  })

  it('fremde Bewertung → 403, Rating an anderem Ziel → 404, kein Update', async () => {
    ratingFindUnique.mockResolvedValue({ ...RATING, userId: 'user-2' })
    expect((await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PATCH', { stars: 1 }))).status).toBe(403)

    ratingFindUnique.mockResolvedValue({ ...RATING, targetId: 'anderes-teil' })
    expect((await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PATCH', { stars: 1 }))).status).toBe(404)
    expect(ratingUpdate).not.toHaveBeenCalled()
  })

  it('leerer Patch → 400, fehlende ratingId → 400', async () => {
    ratingFindUnique.mockResolvedValue(RATING)
    expect((await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', 'PATCH', {}))).status).toBe(400)
    expect((await PATCH(jsonReq('http://localhost/api/ratings?targetType=PART&targetId=p1', 'PATCH', { stars: 3 }))).status).toBe(400)
    expect(ratingUpdate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/ratings (#143)', () => {
  const RATING = { id: 'r1', userId: 'user-1', targetType: 'PART', targetId: 'p1' }

  it('löscht die eigene Bewertung (ohne AuditLog)', async () => {
    ratingFindUnique.mockResolvedValue(RATING)

    const res = await DELETE(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(txRatingDelete).toHaveBeenCalledWith({ where: { id: 'r1' } })
    expect(txAuditLogCreate).not.toHaveBeenCalled()
  })

  it('TRUSTED/ADMIN moderiert fremde Bewertung + append-only AuditLog (im selben Tx)', async () => {
    ratingFindUnique.mockResolvedValue({ ...RATING, userId: 'user-2' })
    userFindUnique.mockResolvedValue({ role: 'TRUSTED' })

    const res = await DELETE(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(txAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-1',
        action: 'rating.moderate_remove',
        targetType: 'rating',
        targetId: 'r1',
      }),
    })
  })

  it('normaler Fremduser → 403, Rating an anderem Ziel → 404 — kein Delete', async () => {
    ratingFindUnique.mockResolvedValue({ ...RATING, userId: 'user-2' })
    userFindUnique.mockResolvedValue({ role: 'USER' })
    expect((await DELETE(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', { method: 'DELETE' }))).status).toBe(403)

    ratingFindUnique.mockResolvedValue({ ...RATING, targetType: 'BUILD', targetId: 'b9' })
    expect((await DELETE(new Request('http://localhost/api/ratings?targetType=PART&targetId=p1&ratingId=r1', { method: 'DELETE' }))).status).toBe(404)
    expect(txRatingDelete).not.toHaveBeenCalled()
  })
})
