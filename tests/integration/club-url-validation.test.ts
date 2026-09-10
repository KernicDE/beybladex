// tests/integration/club-url-validation.test.ts
// Issue #47: club profile links get a hard https?-only server-side allowlist
// (lib/urlValidation.ts) because they are rendered verbatim into <a href> on the
// public club page. Integration — CI-only (Postgres/Redis).
// Covers: POST /api/clubs and PATCH /api/clubs/[slug] rejecting javascript:/data:/
// protocol-relative URLs with 400, while valid https:// URLs pass end to end.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as CREATE_CLUB } from '@/app/api/clubs/route'
import { PATCH as PATCH_CLUB } from '@/app/api/clubs/[slug]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, { method, body: body === undefined ? null : JSON.stringify(body) })
}

async function seedUser(suffix: string, prefix: string) {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role: 'USER' } })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('club URL allowlist (issue #47)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('POST rejects javascript:, data: and protocol-relative URLs with 400', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'urlown')

    for (const [i, badUrl] of ['javascript:alert(1)', 'data:text/html,<script>1</script>', '//evil.example/x'].entries()) {
      mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
      const res = await CREATE_CLUB(jsonRequest('http://localhost/api/clubs', 'POST', {
        name: `URL Club ${suffix} ${i}`,
        websiteUrl: badUrl,
      }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_club_url')
    }

    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('POST accepts a valid https URL and stores it', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'urlown')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const res = await CREATE_CLUB(jsonRequest('http://localhost/api/clubs', 'POST', {
      name: `URL Club ${suffix}`,
      websiteUrl: 'https://example.com',
      discordUrl: 'https://discord.gg/abc',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()

    const row = await prisma.club.findUnique({ where: { id: body.id }, select: { websiteUrl: true, discordUrl: true } })
    expect(row?.websiteUrl).toBe('https://example.com')
    expect(row?.discordUrl).toBe('https://discord.gg/abc')

    await prisma.club.delete({ where: { id: body.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('PATCH rejects a javascript: URL (400) and keeps the stored value unchanged', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'urlown')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const createRes = await CREATE_CLUB(jsonRequest('http://localhost/api/clubs', 'POST', {
      name: `URL Club ${suffix}`,
      websiteUrl: 'https://example.com',
    }))
    const created = await createRes.json()

    const badRes = await PATCH_CLUB(jsonRequest(`http://localhost/api/clubs/${created.slug}`, 'PATCH', {
      websiteUrl: 'javascript:alert(1)',
    }), ctx(created.slug))
    expect(badRes.status).toBe(400)

    const goodRes = await PATCH_CLUB(jsonRequest(`http://localhost/api/clubs/${created.slug}`, 'PATCH', {
      websiteUrl: 'https://new.example.com',
    }), ctx(created.slug))
    expect(goodRes.status).toBe(200)

    const row = await prisma.club.findUnique({ where: { id: created.id }, select: { websiteUrl: true } })
    expect(row?.websiteUrl).toBe('https://new.example.com')

    await prisma.club.delete({ where: { id: created.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })
})
