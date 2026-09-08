// tests/unit/totp.test.ts
// Pure otplib functions — no prisma/redis — safe under tests/unit (npm test).
import { describe, it, expect } from 'vitest'
import { generateTotpSecret, verifyTotp } from '@/lib/totp'
import { authenticator } from 'otplib'

describe('TOTP 2FA', () => {
  it('generates a secret and verifies a valid current token', () => {
    const { secret, otpauthUrl } = generateTotpSecret('testuser')
    expect(otpauthUrl).toContain('otpauth://totp/')
    const token = authenticator.generate(secret)
    expect(verifyTotp(secret, token)).toBe(true)
    expect(verifyTotp(secret, '000000')).toBe(false)
  })
})
