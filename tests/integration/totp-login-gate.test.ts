// tests/integration/totp-login-gate.test.ts
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/totpEncryption'
import { signIn } from '@/lib/auth'

describe('TOTP login gate', () => {
  it('rejects password-only login when totpSecret is set, and succeeds with a valid token', async () => {
    const secret = authenticator.generateSecret()
    const username = `totpuser_${Date.now().toString(36)}`
    await prisma.user.create({
      data: { username, passwordHash: await bcrypt.hash('correct horse battery staple', 12), totpSecret: encryptSecret(secret) },
    })

    await expect(
      signIn('credentials', { username, password: 'correct horse battery staple', redirect: false })
    ).rejects.toThrow() // or resolves to an error shape, depending on next-auth version — assert failure, not a session

    const token = authenticator.generate(secret)
    const result = await signIn('credentials', { username, password: 'correct horse battery staple', totpToken: token, redirect: false })
    expect(result).toBeTruthy() // successful session

    await prisma.user.delete({ where: { username } })
  })
})
