// tests/unit/totp-encryption.test.ts
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/totpEncryption'

describe('TOTP secret encryption', () => {
  it('round-trips a secret and produces different ciphertext each time (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const a = encryptSecret(secret)
    const b = encryptSecret(secret)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(secret)
    expect(decryptSecret(b)).toBe(secret)
  })
})
