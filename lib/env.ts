// lib/env.ts (RC3 #60)
// Central validation of the security-critical environment, run ONCE at server boot from
// instrumentation.ts's register() — never on module import, so unit tests, scripts and partial
// local setups can import server modules (lib/totpEncryption, lib/auth, …) without a full
// production env. A misconfigured deploy must die loudly at boot, not intransparently at first
// use of some feature.
//
// Two severity levels:
// - fatal:  missing/invalid values the server cannot safely run without → validateServerEnv throws
// - warning: optional integrations that degrade gracefully without configuration (see
//   .env.example's "logs-and-noops" convention for SMTP and VAPID) → logged, never fatal.

// The CI/docker-boot-test env provides exactly these six; anything stricter would break CI.
const REQUIRED_VARS = ['DATABASE_URL', 'REDIS_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'WEBAUTHN_RP_ID'] as const

// Obvious non-production placeholders — worth a loud warning, not a boot failure (CI and local
// dev legitimately run with these).
const PLACEHOLDER_SECRETS = new Set(['dev-secret-change-me', 'ci-test-secret-not-for-production'])

// Optional groups: every member of a group must be set together or not at all (partial config is
// almost certainly a copy/paste mistake, but the modules treat "host/key unset" as log-and-noop,
// so this stays a warning).
const OPTIONAL_GROUPS: Array<{ vars: string[]; integration: string }> = [
  { vars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'], integration: 'SMTP mail (lib/mailer.ts)' },
  { vars: ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'], integration: 'Web Push (lib/webPush.ts)' },
  { vars: ['DEEPL_API_KEY'], integration: 'UGC auto-translation (lib/i18n/deepl.ts)' },
]

function checkTotpKey(raw: string | undefined, fatal: string[], warnings: string[]) {
  if (!raw) {
    fatal.push('TOTP_ENCRYPTION_KEY is missing — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"')
    return
  }
  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    decoded = Buffer.alloc(0)
  }
  // A 34-byte key (the old .env.example value) booted fine but crashed AES-256-GCM at first
  // TOTP use — the exact "error at first use instead of at boot" class this module exists to kill.
  // Note: Buffer.from(..., 'base64') silently ignores malformed input, so also compare the
  // re-encode to catch garbage that merely decodes to something.
  if (decoded.length !== 32 || decoded.toString('base64') !== raw) {
    fatal.push(`TOTP_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes (decodes to ${decoded.length} bytes) — generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
  }
}

export interface ServerEnvReport {
  fatal: string[]
  warnings: string[]
}

/** Validates the environment. Throws with a clear, complete message on fatal problems. */
export function validateServerEnv(env: Record<string, string | undefined> = process.env): void {
  const { fatal, warnings } = inspectServerEnv(env)
  for (const w of warnings) console.warn(`[env] warning: ${w}`)
  if (fatal.length > 0) {
    throw new Error(`[env] Invalid server configuration — refusing to start:\n - ${fatal.join('\n - ')}`)
  }
}

/** Pure validation (no logging/throwing) — used by tests and validateServerEnv. */
export function inspectServerEnv(env: Record<string, string | undefined> = process.env): ServerEnvReport {
  const fatal: string[] = []
  const warnings: string[] = []

  for (const name of REQUIRED_VARS) {
    if (!env[name]) fatal.push(`${name} is missing`)
  }
  if (env.NEXTAUTH_SECRET && PLACEHOLDER_SECRETS.has(env.NEXTAUTH_SECRET)) {
    warnings.push(`NEXTAUTH_SECRET is a known placeholder value — set a real secret in production`)
  }

  checkTotpKey(env.TOTP_ENCRYPTION_KEY, fatal, warnings)

  if (!env.INTERNAL_CRON_SECRET) {
    warnings.push('INTERNAL_CRON_SECRET is missing — POST /api/internal/cleanup-notifications will reject calls until it is set')
  }

  for (const { vars, integration } of OPTIONAL_GROUPS) {
    const set = vars.filter((v) => env[v])
    if (set.length > 0 && set.length < vars.length) {
      warnings.push(`${integration}: partially configured (${set.join(', ')} set, missing ${vars.filter((v) => !env[v]).join(', ')}) — treating as unconfigured (log-and-noop)`)
    }
  }

  return { fatal, warnings }
}

// --- Typed accessors for values that need format guarantees beyond "present" ---------------
// lib/totpEncryption.ts reads the key through this accessor instead of raw process.env so the
// 32-byte base64 contract lives in exactly one place.

let cachedTotpKey: Buffer | undefined

/** The decoded TOTP_ENCRYPTION_KEY (32 bytes). Throws a clear error if unset/invalid. */
export function getTotpEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  if (cachedTotpKey) return cachedTotpKey
  const raw = env.TOTP_ENCRYPTION_KEY
  const fatal: string[] = []
  checkTotpKey(raw, fatal, [])
  if (fatal.length > 0) throw new Error(`[env] ${fatal[0]}`)
  cachedTotpKey = Buffer.from(raw!, 'base64')
  return cachedTotpKey
}
