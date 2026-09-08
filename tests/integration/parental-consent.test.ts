// tests/integration/parental-consent.test.ts
import { describe, it, expect } from 'vitest'
import { POST as register } from '@/app/api/register/route'
import { GET as consent } from '@/app/api/parental-consent/[token]/route'
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { signIn } from '@/lib/auth'

async function registerMinor(username: string) {
  const req = new Request('http://localhost/api/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: 'correct horse battery staple',
      birthDate: '2015-01-01', // 11 years old at the time of writing
      privacyPolicyAccepted: true,
      parentalConsentEmail: 'parent@example.de',
    }),
  })
  return register(req)
}

describe('parental-consent confirmation flow', () => {
  it('registers a minor as PENDING_PARENTAL_CONSENT, refuses login, then activates on token use', async () => {
    const username = `minor_${Date.now().toString(36)}`
    const res = await registerMinor(username)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('PENDING_PARENTAL_CONSENT')

    const user = await prisma.user.findUnique({ where: { username } })
    expect(user!.status).toBe('PENDING_PARENTAL_CONSENT')
    expect(user!.parentalConsentAt).toBeNull()

    // login is refused while consent is pending
    await expect(
      signIn('credentials', { username, password: 'correct horse battery staple', redirect: false })
    ).rejects.toThrow()

    // No mailer yet (Phase 3), so read the token back from Redis directly:
    // the register route stores exactly one parental-consent token for this user.
    const keys = await redis.keys(`parental-consent:*`)
    let token: string | null = null
    for (const key of keys) {
      if ((await redis.get(key)) === user!.id) {
        token = key.slice('parental-consent:'.length)
        break
      }
    }
    expect(token).not.toBeNull()

    // consuming the confirmation link flips the account to ACTIVE
    const confirmReq = new Request(`http://localhost/api/parental-consent/${token}`)
    const confirmRes = await consent(confirmReq, { params: Promise.resolve({ token: token! }) })
    expect(confirmRes.status).toBe(200)

    const activated = await prisma.user.findUnique({ where: { username } })
    expect(activated!.status).toBe('ACTIVE')
    expect(activated!.parentalConsentAt).not.toBeNull()

    // login now succeeds
    const loginResult = await signIn('credentials', { username, password: 'correct horse battery staple', redirect: false })
    expect(loginResult).toBeTruthy()

    await prisma.user.delete({ where: { username } })
  })

  it('rejects a second GET with the same (now consumed) token', async () => {
    const username = `minor2_${Date.now().toString(36)}`
    await registerMinor(username)
    const user = await prisma.user.findUnique({ where: { username } })

    const keys = await redis.keys(`parental-consent:*`)
    let token: string | null = null
    for (const key of keys) {
      if ((await redis.get(key)) === user!.id) {
        token = key.slice('parental-consent:'.length)
        break
      }
    }
    expect(token).not.toBeNull()

    const first = await consent(new Request(`http://localhost/api/parental-consent/${token}`), { params: Promise.resolve({ token: token! }) })
    expect(first.status).toBe(200)

    const second = await consent(new Request(`http://localhost/api/parental-consent/${token}`), { params: Promise.resolve({ token: token! }) })
    expect(second.status).toBe(400)

    await prisma.user.delete({ where: { username } })
  })

  it('returns 400 for a token that was never issued', async () => {
    const res = await consent(new Request('http://localhost/api/parental-consent/does-not-exist'), {
      params: Promise.resolve({ token: 'does-not-exist' }),
    })
    expect(res.status).toBe(400)
  })
})
