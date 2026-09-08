// lib/totp.ts
import { authenticator } from 'otplib'

export function generateTotpSecret(username: string) {
  const secret = authenticator.generateSecret()
  const otpauthUrl = authenticator.keyuri(username, 'BeybladeX.de', secret)
  return { secret, otpauthUrl }
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret })
  } catch {
    return false
  }
}
