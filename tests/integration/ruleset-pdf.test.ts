// tests/integration/ruleset-pdf.test.ts
// Phase 2: GET /rules/[slug]/pdf streams application/pdf with every rule field rendered;
// a private ruleset's PDF is 404 for a non-owner (404-not-403 policy, same as the view).
// Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GET } from '@/app/rules/[slug]/pdf/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('ruleset PDF export', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('returns content-type application/pdf with a PDF magic body for a public ruleset', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `pdf_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({
      data: {
        title: `PDF Regelwerk ${suffix}`,
        slug: `pdf-regelwerk-${suffix}`,
        createdById: owner.id,
        isPublic: true,
        deckFormat: 'THREE_ON_THREE',
        targetPoints: 6,
        externalDisturbanceRerun: false,
      },
    })

    mockAuth.mockResolvedValue(asSession(null))
    const res = await GET(
      new Request(`http://localhost/rules/${ruleset.slug}/pdf`),
      { params: Promise.resolve({ slug: ruleset.slug }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(500) // a real document, not an empty buffer
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('returns 404 (not 403) for a private ruleset the viewer does not own, 200 for the owner', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `pdfp_${suffix}`, passwordHash: 'x' } })
    const other = await prisma.user.create({ data: { username: `pdfo_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({
      data: { title: `Privat PDF ${suffix}`, slug: `privat-pdf-${suffix}`, createdById: owner.id, isPublic: false },
    })
    const ctx = { params: Promise.resolve({ slug: ruleset.slug }) }

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    const stranger = await GET(new Request(`http://localhost/rules/${ruleset.slug}/pdf`), ctx)
    expect(stranger.status).toBe(404)
    expect(stranger.headers.get('content-type')).not.toBe('application/pdf')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const own = await GET(new Request(`http://localhost/rules/${ruleset.slug}/pdf`), ctx)
    expect(own.status).toBe(200)
    expect(own.headers.get('content-type')).toBe('application/pdf')

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('returns 404 for an unknown slug', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await GET(
      new Request('http://localhost/rules/gibt-es-nicht/pdf'),
      { params: Promise.resolve({ slug: 'gibt-es-nicht' }) },
    )
    expect(res.status).toBe(404)
  })
})
