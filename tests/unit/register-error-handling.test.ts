// tests/unit/register-error-handling.test.ts (RC3 issue #64)
// Malformed request bodies must yield a stable 400 (previously an unhandled 500 from req.json()),
// and the check-then-create race on the unique username must surface as 409, not 500.
// Seams mocked on '@/' imports; bcryptjs runs really (one hash per successful-create test is
// affordable). No DB/Redis involved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.fn()
const userCreate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a), create: (...a: unknown[]) => userCreate(...a) } },
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true, remaining: 4 })) }))
vi.mock('@/lib/redis', () => ({ redis: { set: vi.fn(async () => 'OK') } }))

import { POST } from '@/app/api/register/route'

const URL = 'http://localhost/api/register'

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    username: 'newplayer',
    password: 'supersecret1',
    birthDate: '1990-06-01',
    privacyPolicyAccepted: true,
    ...overrides,
  })
}

function post(body: string) {
  return new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
}

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue(null)
  userCreate.mockResolvedValue({ id: 'user-1', username: 'newplayer', status: 'ACTIVE' })
})

describe('POST /api/register request-body handling (issue #64)', () => {
  it('returns 400 invalid_json for a malformed JSON body instead of crashing', async () => {
    const res = await POST(post('{ "username": "truncated'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userCreate).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_json for a non-JSON body', async () => {
    const res = await POST(post('this is not json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
  })

  it('returns 400 invalid_body for a valid-JSON non-object body', async () => {
    const res = await POST(post('"just a string"'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })

  it('creates the user for a valid body (201)', async () => {
    const res = await POST(post(validBody()))

    expect(res.status).toBe(201)
    expect(userCreate).toHaveBeenCalled()
  })
})

describe('POST /api/register uniqueness handling (issues #64, #65)', () => {
  it('returns 409 username_taken when the username already exists', async () => {
    userFindUnique.mockResolvedValue({ id: 'existing-user' })

    const res = await POST(post(validBody()))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'username_taken' })
    expect(userCreate).not.toHaveBeenCalled()
  })

  it('returns 409 username_taken when a CONCURRENT registration wins the create race (P2002)', async () => {
    // The pre-check found nothing, but between check and create another request took the name:
    // prisma surfaces the unique-constraint violation as P2002. Must be a 409, not a 500.
    userCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    const res = await POST(post(validBody()))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'username_taken' })
  })

  it('still propagates unexpected create errors as failures', async () => {
    userCreate.mockRejectedValue(new Error('connection reset'))

    await expect(POST(post(validBody()))).rejects.toThrow('connection reset')
  })
})

describe('POST /api/register email handling (issue #65)', () => {
  it.each(['not-an-email', 'a b@c.de', 'missing-at-sign.de', 'a@b c.de'])(
    'rejects malformed email %j with 400 invalid_email',
    async (email) => {
      const res = await POST(post(validBody({ email })))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_email' })
      expect(userCreate).not.toHaveBeenCalled()
    }
  )

  it('rejects an overlong email (>254 chars) with 400 invalid_email', async () => {
    const res = await POST(post(validBody({ email: `${'a'.repeat(250)}@example.com` })))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_email' })
  })

  it('accepts a well-formed email and stores it', async () => {
    const res = await POST(post(validBody({ email: ' Player@Example.COM ' })))

    expect(res.status).toBe(201)
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'Player@Example.COM' }) })
    )
  })

  it('treats an absent email as optional (stores null)', async () => {
    const res = await POST(post(validBody()))

    expect(res.status).toBe(201)
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: null }) })
    )
  })

  it('has NO email-exists oracle: an email already used elsewhere does not block registration', async () => {
    // Email is not unique in the schema and never looked up at registration — a second account
    // with the same address must register fine and the response must not leak anything about
    // the address's prior use.
    const res = await POST(post(validBody({ email: 'already.used@example.com' })))

    expect(res.status).toBe(201)
  })
})
