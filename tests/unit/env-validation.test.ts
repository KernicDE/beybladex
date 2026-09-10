// tests/unit/env-validation.test.ts (RC3 issue #60)
// Misconfiguration must surface at BOOT (validateServerEnv, called from instrumentation.ts's
// register), with a clear message naming every broken variable — not intransparently at first
// use. Pure unit test: inspectServerEnv/validateServerEnv take an explicit env object, no
// process env mutation except one resetModules-isolated accessor case.
import { describe, it, expect, afterEach, vi } from 'vitest'

import { inspectServerEnv, validateServerEnv } from '@/lib/env'

const VALID_KEY = Buffer.from('a'.repeat(32)).toString('base64') // exactly 32 bytes

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'a-real-secret-long-enough',
    WEBAUTHN_RP_ID: 'localhost',
    TOTP_ENCRYPTION_KEY: VALID_KEY,
    INTERNAL_CRON_SECRET: 'cron-secret',
    ...overrides,
  }
}

afterEach(() => {
  vi.resetModules()
})

describe('inspectServerEnv', () => {
  it('accepts a complete, valid configuration', () => {
    expect(inspectServerEnv(baseEnv())).toEqual({ fatal: [], warnings: [] })
  })

  it('reports every missing required variable as fatal', () => {
    const { fatal, warnings } = inspectServerEnv({})
    for (const name of ['DATABASE_URL', 'REDIS_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'WEBAUTHN_RP_ID', 'TOTP_ENCRYPTION_KEY']) {
      expect(fatal.join('\n')).toContain(name)
    }
    // The only warning on an otherwise empty env is the non-fatal INTERNAL_CRON_SECRET one.
    expect(warnings.every((w) => w.includes('INTERNAL_CRON_SECRET'))).toBe(true)
  })

  it('rejects a TOTP_ENCRYPTION_KEY that is not 32 bytes when decoded', () => {
    const thirtyFourBytes = Buffer.from('b'.repeat(34)).toString('base64')
    const { fatal } = inspectServerEnv(baseEnv({ TOTP_ENCRYPTION_KEY: thirtyFourBytes }))
    expect(fatal.join('\n')).toMatch(/TOTP_ENCRYPTION_KEY.*32 bytes/)
  })

  it('rejects a TOTP_ENCRYPTION_KEY that is not valid base64', () => {
    const { fatal } = inspectServerEnv(baseEnv({ TOTP_ENCRYPTION_KEY: '!!!not-base64!!!' }))
    expect(fatal.join('\n')).toContain('TOTP_ENCRYPTION_KEY')
  })

  it('warns (not fatal) on a placeholder NEXTAUTH_SECRET', () => {
    const { fatal, warnings } = inspectServerEnv(baseEnv({ NEXTAUTH_SECRET: 'dev-secret-change-me' }))
    expect(fatal).toEqual([])
    expect(warnings.join('\n')).toContain('NEXTAUTH_SECRET')
  })

  it('warns (not fatal) on partially configured optional integrations', () => {
    const { fatal, warnings } = inspectServerEnv(
      baseEnv({ SMTP_HOST: 'mail.example.com', SMTP_USER: undefined, SMTP_PASSWORD: undefined })
    )
    expect(fatal).toEqual([])
    expect(warnings.join('\n')).toMatch(/SMTP.*partially configured/)
  })

  it('warns (not fatal) when INTERNAL_CRON_SECRET is missing', () => {
    const { fatal, warnings } = inspectServerEnv(baseEnv({ INTERNAL_CRON_SECRET: undefined }))
    expect(fatal).toEqual([])
    expect(warnings.join('\n')).toContain('INTERNAL_CRON_SECRET')
  })
})

describe('validateServerEnv (the boot path)', () => {
  it('throws with a clear message at boot when the TOTP key is missing', () => {
    const env = baseEnv({ TOTP_ENCRYPTION_KEY: undefined })
    expect(() => validateServerEnv(env)).toThrow(/TOTP_ENCRYPTION_KEY/)
    expect(() => validateServerEnv(env)).toThrow(/refusing to start/)
  })

  it('does not throw for a valid configuration', () => {
    expect(() => validateServerEnv(baseEnv())).not.toThrow()
  })
})

describe('getTotpEncryptionKey (the lib/totpEncryption accessor)', () => {
  // Fresh module per test: the accessor caches the decoded key, and the static import above
  // would keep the first test's cache across resetModules.
  async function freshAccessor() {
    vi.resetModules()
    return (await import('@/lib/env')).getTotpEncryptionKey
  }

  it('returns the decoded 32-byte key', async () => {
    const key = await (await freshAccessor())(baseEnv())
    expect(key).toHaveLength(32)
  })

  it('throws a clear error immediately when the key is missing — not at cipher use', async () => {
    const getKey = await freshAccessor()
    // The error names the variable and the fix; encryptSecret would never be reached with a
    // silently-undefined key the way the old module-level process.env read allowed.
    expect(() => getKey({})).toThrow(/TOTP_ENCRYPTION_KEY/)
  })
})
