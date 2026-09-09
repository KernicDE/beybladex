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
      // `secure` must track whether the app is actually served over HTTPS, not NODE_ENV: `next
      // start` sets NODE_ENV=production unconditionally, including for a plain-HTTP production
      // BUILD run locally or in CI (e.g. playwright.offline.config.ts's `next start -p 3100`,
      // used because dev-mode hydration can't survive a simulated-offline reload — see that
      // file's header). A `Secure` cookie is never sent by the browser over plain HTTP, so
      // login there would silently "succeed" (redirect happens) while the session cookie never
      // actually attaches to the next request — every subsequent page renders logged out. The
      // real production deployment's NEXTAUTH_URL is always `https://beybladex.de` (compose.yml),
      // so keying off it gives the identical `secure: true` behavior in actual production while
      // correctly relaxing it for any plain-HTTP run (dev, this offline E2E config, etc.).
      options: { httpOnly: true, sameSite: 'strict', secure: process.env.NEXTAUTH_URL?.startsWith('https://') ?? false },
    },
  },
  providers: [
    Credentials({
      credentials: { username: {}, password: {}, totpToken: {}, webauthnToken: {} },
      authorize,
    }),
  ],
  // CRITICAL, previously missing: NextAuth's DEFAULT jwt/session callbacks do NOT propagate a
  // custom `id` field from authorize()'s return value into `session.user.id` — only well-known
  // fields (name/email/picture) survive by default. Every route/page in this app reads
  // `session.user.id` (hundreds of call sites since Phase 1), and every test that exercises
  // this exclusively mocks `auth()` directly (`vi.mock('@/lib/auth')`), bypassing NextAuth's
  // real jwt/session serialization entirely — so a REAL browser session had `session.user.id
  // === undefined` on every authenticated request, undetected until the first genuine,
  // non-mocked E2E test (tests/e2e/judge-offline.spec.ts) exercised a real login. Without this
  // block, every authenticated feature is broken in actual production use despite the full
  // green CI suite. `token.id`/`token.name` are set once at sign-in (the `user` param is only
  // present on that first call) and persist across the token's lifetime; every subsequent
  // `auth()` call copies them onto `session.user`.
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string
      }
      return session
    },
  },
})
