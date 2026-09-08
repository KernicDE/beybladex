// tests/integration/webauthn.test.ts
import { describe, it, expect } from 'vitest'
import { getRegistrationOptions } from '@/lib/webauthn'
import { prisma } from '@/lib/db'

describe('WebAuthn passkey registration', () => {
  it('produces registration options scoped to the given user with no existing credentials excluded', async () => {
    const user = await prisma.user.create({ data: { username: `wauser_${Date.now().toString(36)}` } })
    const options = await getRegistrationOptions(user.id)
    expect(options.user.name).toBe(user.username)
    expect(options.excludeCredentials).toEqual([])
    await prisma.user.delete({ where: { id: user.id } })
  })
})
