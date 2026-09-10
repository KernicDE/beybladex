// tests/unit/webauthn-authenticate-binding.test.ts
// Regression test for https://github.com/KernicDE/beybladex/issues/39:
// a WebAuthn challenge minted for username <victim> answered with the attacker's OWN passkey
// must be rejected — previously the route issued a session for <victim> because it looked the
// user up by the challenge record's username instead of the verified passkey's owner.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ATTACKER = { id: 'attacker-user-id', username: 'attacker', credentialId: 'attacker-cred' }
const VICTIM = { id: 'victim-user-id', username: 'victim' }

const passkeyFindUnique = vi.fn()
const userFindUniqueOrThrow = vi.fn()
const signIn = vi.fn()
const redisStore = new Map<string, string>()

vi.mock('@/lib/db', () => ({
  prisma: {
    passkey: { findUnique: (...a: unknown[]) => passkeyFindUnique(...a), update: vi.fn() },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { username: string } }) =>
        where.username === VICTIM.username ? { ...VICTIM, passkeys: [] } : null
      ),
      findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a),
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => { redisStore.delete(key) }),
    set: vi.fn(async (key: string, value: string) => { redisStore.set(key, value) }),
  },
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
}))

vi.mock('@/lib/auth', () => ({
  signIn: (...a: unknown[]) => signIn(...a),
}))

// Real WebAuthn crypto ceremony is out of scope here; simulate a cryptographically VALID
// assertion for whatever passkey record the lookup returns (the attacker's).
vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'challenge-value' })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 2 },
  })),
}))

import { GET, POST } from '@/app/api/webauthn/authenticate/route'

function postBody(username: string, credentialId: string) {
  return {
    nonce: 'nonce-1',
    response: { id: credentialId, rawId: credentialId, type: 'public-key' },
  }
}

function challengeRecordFor(username: string) {
  return JSON.stringify({ username, challenge: 'challenge-value' })
}

beforeEach(() => {
  vi.clearAllMocks()
  redisStore.clear()
  passkeyFindUnique.mockResolvedValue({
    id: 'passkey-1',
    userId: ATTACKER.id,
    credentialId: ATTACKER.credentialId,
    publicKey: 'cHVia2V5',
    counter: 1,
  })
  userFindUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id === ATTACKER.id) return ATTACKER
    if (where.id === VICTIM.id) return VICTIM
    throw new Error('user not found')
  })
})

describe('POST /api/webauthn/authenticate user binding (issue #39)', () => {
  it('REJECTS a valid own-passkey assertion presented against a challenge minted for another user', async () => {
    // Challenge was minted for the VICTIM (as via GET ?username=victim)…
    redisStore.set('webauthn-challenge:nonce-1', challengeRecordFor(VICTIM.username))
    // …but the response carries the ATTACKER's passkey, which verifies fine on its own.
    const res = await POST(
      new Request('http://localhost/api/webauthn/authenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postBody(VICTIM.username, ATTACKER.credentialId)),
      })
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'credential_user_mismatch' })
    // No session may be minted and no user lookup may target the victim's identity.
    expect(signIn).not.toHaveBeenCalled()
    expect(userFindUniqueOrThrow).not.toHaveBeenCalledWith(expect.objectContaining({ where: { username: VICTIM.username } }))
  })

  it('ACCEPTS the regular flow: own passkey against own challenge', async () => {
    redisStore.set('webauthn-challenge:nonce-1', challengeRecordFor(ATTACKER.username))
    signIn.mockResolvedValue({ ok: true })

    const res = await POST(
      new Request('http://localhost/api/webauthn/authenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postBody(ATTACKER.username, ATTACKER.credentialId)),
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: ATTACKER.id, username: ATTACKER.username })
    expect(signIn).toHaveBeenCalledWith('credentials', expect.objectContaining({ redirect: false }))
  })

  it('rejects when the passkey is unknown (no userId to bind to)', async () => {
    redisStore.set('webauthn-challenge:nonce-1', challengeRecordFor(ATTACKER.username))
    passkeyFindUnique.mockResolvedValue(null)

    const res = await POST(
      new Request('http://localhost/api/webauthn/authenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postBody(ATTACKER.username, 'unknown-cred')),
      })
    )

    expect(res.status).toBe(401)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('GET still mints challenges scoped to the requested username', async () => {
    const res = await GET(new Request('http://localhost/api/webauthn/authenticate?username=victim'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('options.challenge')
    expect(redisStore.has(`webauthn-challenge:${body.nonce}`)).toBe(true)
  })
})
