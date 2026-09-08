// tests/integration/totp-login-gate.test.ts
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/totpEncryption'
import { authorize } from '@/lib/auth'

describe('TOTP login gate', () => {
  it('rejects password-only login when totpSecret is set, and succeeds with a valid token', async () => {
    const secret = authenticator.generateSecret()
    const username = `totpuser_${Date.now().toString(36)}`
    await prisma.user.create({
      data: { username, passwordHash: await bcrypt.hash('correct horse battery staple', 12), totpSecret: encryptSecret(secret) },
    })

    const withoutToken = await authorize({ username, password: 'correct horse battery staple' })
    expect(withoutToken).toBeNull()

    const token = authenticator.generate(secret)
    const withToken = await authorize({ username, password: 'correct horse battery staple', totpToken: token })
    expect(withToken).toMatchObject({ id: expect.any(String), name: username })

    await prisma.user.delete({ where: { username } })
  })
})
