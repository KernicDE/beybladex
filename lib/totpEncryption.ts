// lib/totpEncryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getTotpEncryptionKey } from '@/lib/env'

// TOTP_ENCRYPTION_KEY must be a 32-byte key, base64-encoded, in env (never committed).
// Generate once with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// The key is read through lib/env's accessor (single home for the 32-byte base64 contract;
// validated at boot via instrumentation.ts) instead of raw process.env — lazy so importing this
// module in tests/scripts without boot validation still works when the env var is set.
let key: Buffer | undefined
function getKey(): Buffer {
  return (key ??= getTotpEncryptionKey())
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptSecret(cipherText: string): string {
  const raw = Buffer.from(cipherText, 'base64')
  const iv = raw.subarray(0, 12)
  const authTag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
