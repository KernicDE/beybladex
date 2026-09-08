// lib/auth.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { redis } from '@/lib/redis'

export async function authorize(credentials: Partial<Record<'username' | 'password' | 'totpToken' | 'webauthnToken', unknown>>) {
  // [REVIEW-FIX: backend-security #6] WebAuthn login ceremony: POST /api/webauthn/authenticate
  // verifies the Redis-backed passkey challenge, then mints a single-use, short-lived
  // "verified" token in Redis and calls signIn with it on this branch. GETDEL consumes the
  // token atomically, so the ceremony can't be replayed and no password is involved.
  const webauthnToken = credentials?.webauthnToken as string | undefined
  if (webauthnToken) {
    const verifiedUsername = await redis.getdel(`webauthn-verified:${webauthnToken}`)
    if (!verifiedUsername) return null
    const passkeyUser = await prisma.user.findUnique({ where: { username: verifiedUsername } })
    if (!passkeyUser || passkeyUser.status === 'PENDING_PARENTAL_CONSENT') return null
    return { id: passkeyUser.id, name: passkeyUser.username }
  }

  const username = (credentials?.username as string | undefined)?.toLowerCase()
  const password = credentials?.password as string | undefined
  if (!username || !password) return null

  // [REVIEW-FIX: backend-security #4] rate-limit login attempts per username AND per source,
  // so neither a distributed brute force nor a focused single-account attack is unlimited.
  const { allowed } = await rateLimit(`login:${username}`, 10, 60 * 15)
  if (!allowed) return null

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user?.passwordHash) return null
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return null

  // [REVIEW-FIX: backend-security #3] TOTP is a real second factor, not enrollment theater:
  // if the account has a TOTP secret set, a session is refused unless a valid current token
  // was submitted alongside the password in the SAME request. See Task 6 for verifyTotp().
  if (user.totpSecret) {
    const totpToken = credentials?.totpToken as string | undefined
    if (!totpToken) return null // client should show a 2FA step and resubmit with totpToken
    const { verifyTotp } = await import('@/lib/totp')
    const { decryptSecret } = await import('@/lib/totpEncryption')
    const validTotp = verifyTotp(decryptSecret(user.totpSecret), totpToken)
    if (!validTotp) return null
  }

  // [REVIEW-FIX: privacy-dsgvo #1] a minor account awaiting parental consent may not log in
  // at all — this is the enforcement point, not merely a UI warning on the register page.
  if (user.status === 'PENDING_PARENTAL_CONSENT') return null

  return { id: user.id, name: user.username }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 days; see Task 6 for tokenVersion revocation
  cookies: {
    sessionToken: {
      options: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' },
    },
  },
  providers: [
    Credentials({
      credentials: { username: {}, password: {}, totpToken: {}, webauthnToken: {} },
      authorize,
    }),
  ],
})
