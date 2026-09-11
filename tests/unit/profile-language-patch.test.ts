// tests/unit/profile-language-patch.test.ts (RC14 #17)
// PATCH /api/profile's new `language` field: the route validates it against the i18n locale
// registry (not a local enum) and persists it on the caller's own row. Seam-mocks on the
// @/ imports (auth/rateLimit/db/geo) — the route module runs for real around them.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted ABOVE top-level declarations — the spies must come from
// vi.hoisted() or the factory hits the const's TDZ ("Cannot access before initialization"),
// which surfaces whenever the mock graph initializes eagerly (CI runs test:all = unit+integration).
const { userUpdate, findUnique } = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1', name: 'kai' } })),
}))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      update: userUpdate,
      findUnique: findUnique,
    },
  },
}))
vi.mock('@/lib/geo', () => ({
  geocodePostalCode: vi.fn(async () => null),
}))

import { PATCH } from '@/app/api/profile/route'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  userUpdate.mockReset()
  findUnique.mockReset()
  findUnique.mockResolvedValue({ postalCode: null, country: 'DE' })
  userUpdate.mockResolvedValue({ language: 'en' })
})

describe('PATCH /api/profile — language (RC14 #17)', () => {
  it('persists a supported language on the caller’s own row', async () => {
    const res = await PATCH(jsonRequest({ language: 'en' }))
    expect(res.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ language: 'en' }),
      }),
    )
  })

  it('accepts the default locale too', async () => {
    const res = await PATCH(jsonRequest({ language: 'de' }))
    expect(res.status).toBe(200)
    expect(userUpdate.mock.calls[0][0].data.language).toBe('de')
  })

  it('rejects an unsupported language with 400 invalid_language', async () => {
    const res = await PATCH(jsonRequest({ language: 'fr' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_language' })
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('rejects non-string language values', async () => {
    const res = await PATCH(jsonRequest({ language: 42 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_language' })
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('leaves language untouched when the field is absent', async () => {
    const res = await PATCH(jsonRequest({ city: 'Berlin' }))
    expect(res.status).toBe(200)
    expect(userUpdate.mock.calls[0][0].data).not.toHaveProperty('language')
  })
})
