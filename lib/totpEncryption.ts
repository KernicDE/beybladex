// lib/totpEncryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// TOTP_ENCRYPTION_KEY must be a 32-byte key, base64-encoded, in env (never committed).
// Generate once with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const KEY = Buffer.from(process.env.TOTP_ENCRYPTION_KEY!, 'base64')

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptSecret(cipherText: string): string {
  const raw = Buffer.from(cipherText, 'base64')
  const iv = raw.subarray(0, 12)
  const authTag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
