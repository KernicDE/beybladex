// lib/auth.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { redis } from '@/lib/redis'
import { getTokenVersion } from '@/lib/tokenVersion'
import type { JWT } from 'next-auth/jwt'

// [REVIEW-FIX: backend-security #50] tokenVersion revocation: authorize() attaches the user's
// current tokenVersion as `tv` to the sign-in user object; jwtCallback stamps it into the JWT
// and re-validates it on every subsequent request. Augmenting the default interfaces keeps both
// assignments type-checked instead of cast.
declare module 'next-auth' {
  interface User { tv?: number }
}
declare module 'next-auth/jwt' {
  interface JWT { tv?: number | null }
}

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
    return { id: passkeyUser.id, name: passkeyUser.username, tv: passkeyUser.tokenVersion }
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

  return { id: user.id, name: user.username, tv: user.tokenVersion }
}

// [REVIEW-FIX: backend-security #50] jwt callback — the revocation enforcement point. Runs on
// EVERY session access (NextAuth v5 JWT strategy), not just at sign-in:
//   - sign-in (user present): stamp id/name and bind the token to the user's current
//     tokenVersion (`tv` claim).
//   - every later request: re-read the live tokenVersion (Redis-cached, see lib/tokenVersion.ts)
//     and return null on ANY mismatch — @auth/core treats null as "invalidate": the session
//     cookie is cleared and auth() returns null. GDPR erasure and TOTP deactivation bump the
//     version, so a stolen pre-bump token dies at its next use instead of living 30 days.
//   - legacy tokens minted before this change carry no tv claim: adopt the current version
//     once (no forced logout on deploy) and enforce from then on.
export async function jwtCallback({ token, user }: { token: JWT; user?: unknown }): Promise<JWT | null> {
  if (user) {
    const u = user as { id: string; name?: string | null; tv?: number }
    token.id = u.id
    token.name = u.name
    token.tv = u.tv ?? null
    return token
  }
  if (token.id) {
    const current = await getTokenVersion(token.id as string)
    if (token.tv === undefined || token.tv === null) {
      if (current === null) return null
      token.tv = current
      return token
    }
    if (current === null || current !== token.tv) return null
  }
  return token
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // CRITICAL, previously missing: NextAuth v5 refuses every request in a NODE_ENV=production
  // process unless trustHost is explicitly true — it rejects with "UntrustedHost" rather than
  // trusting the Host header by default (a CSRF/host-header-injection guard). Discovered when
  // playwright.offline.config.ts's `next start` (which always sets NODE_ENV=production) logged
  // `[auth][error] UntrustedHost` on every /api/auth/session request — login appeared to
  // "succeed" client-side (signIn's redirect still fired) but no session was ever actually
  // issued. Since this repo's ONLY production runtime is Docker's `node server.js`
  // (NODE_ENV=production unconditionally), this bug would have made login impossible on the
  // real deployment too — the standing no-local-Docker CI-only-testing policy meant nothing
  // had ever actually exercised a production-mode login until this E2E run. Setting `trustHost:
  // true` is the correct, standard fix for any deployment sitting behind a reverse proxy
  // (Traefik here) that this app already trusts to route only genuine traffic to it.
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 days; early revocation via tokenVersion (issue #50, see jwtCallback)
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
    jwt: jwtCallback,
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string
      }
      return session
    },
  },
})
