// app/api/register/route.ts
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { redis } from '@/lib/redis'
import { calculateAge, MINOR_CONSENT_AGE_THRESHOLD } from '@/lib/age'
import { getClientIp } from '@/lib/getClientIp'

// [REVIEW-FIX: backend-security #7] username policy: 3-20 chars, ASCII alphanumeric + underscore,
// case-insensitive uniqueness (stored lowercase, displayName preserves original casing separately
// if a later phase adds one), reserved-name blocklist so routes like /profile/api can't be squatted.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const RESERVED_USERNAMES = new Set(['admin', 'api', 'root', 'support', 'moderator', 'beybladex'])

// [RC3 #65] pragmatic server-side email format check (email is OPTIONAL at registration).
// Deliberately not RFC 5322-complete — one reachable domain label with an @ in between is the
// contract; anything fancier is the confirmation-mail's job (an unsendable address simply never
// confirms). Cap 254 chars is the RFC 5321 path limit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX_LENGTH = 254

const PRIVACY_POLICY_VERSION = '2026-09-11' // bump whenever /datenschutz's content changes materially (issue #71)

export async function POST(req: Request) {
  const ip = getClientIp(req) // last XFF hop — leftmost entries are client-spoofable (issue #34)
  // [RC3 #49] fail-closed: registration is anonymous + credential-issuing — without a working
  // limiter it pauses (429) instead of running unthrottled while Redis is down.
  const { allowed } = await rateLimit(`register:${ip}`, 5, 60 * 15, { onRedisError: 'closed' }) // 5 registrations / 15min / IP
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  // [RC3 #64] a malformed/truncated body makes req.json() THROW (was an unhandled 500) — answer
  // a stable 400 instead, same idiom as the other mutating routes.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const username = typeof b.username === 'string' ? b.username.toLowerCase() : ''
  const { password, email, birthDate, privacyPolicyAccepted, parentalConsentEmail } = b

  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) {
    return Response.json({ error: 'invalid_username' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return Response.json({ error: 'invalid_password' }, { status: 400 })
  }
  if (!privacyPolicyAccepted) {
    return Response.json({ error: 'privacy_policy_not_accepted' }, { status: 400 })
  }
  // [RC3 #65] validate the email FORMAT before anything is stored (was: any string, even
  // "not-an-email", was persisted). The field stays optional — an absent or empty email is
  // stored as null (the register form omits the field when the input is empty).
  const emailStr = typeof email === 'string' ? email.trim() : ''
  if (emailStr && (emailStr.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(emailStr))) {
    return Response.json({ error: 'invalid_email' }, { status: 400 })
  }
  const parsedBirthDate = new Date(birthDate as string)
  if (!birthDate || Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate > new Date()) {
    return Response.json({ error: 'invalid_birth_date' }, { status: 400 })
  }
  const age = calculateAge(parsedBirthDate)
  const isMinor = age < MINOR_CONSENT_AGE_THRESHOLD
  if (isMinor && (!parentalConsentEmail || typeof parentalConsentEmail !== 'string' || !parentalConsentEmail.includes('@'))) {
    return Response.json({ error: 'parental_consent_email_required' }, { status: 400 })
  }

  // [RC3 #65] Enumeration-oracle decision — deliberate, documented: the SPECIFIC 409 is kept.
  // Usernames are public on this platform: every account has a public profile page at
  // /[username], so "does this username exist" is enumerable without touching registration at
  // all; a generic "registration failed" here would cost honest users a usable error message
  // and close no real oracle. What remains (response-code amplification) is bounded by the
  // strict per-IP limiter above — 5 attempts / 15 min, fail-closed while Redis is down (#49).
  // Email existence is a non-topic: email is NOT unique in the schema and never looked up
  // here, so registration discloses nothing about which addresses are registered.
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return Response.json({ error: 'username_taken' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 12)
  let user
  try {
    user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        email: emailStr || null,
        birthDate: parsedBirthDate,
        isMinor,
        privacyPolicyAcceptedAt: new Date(),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        status: isMinor ? 'PENDING_PARENTAL_CONSENT' : 'ACTIVE',
        parentalConsentEmail: isMinor ? (parentalConsentEmail as string) : null,
      },
    })
  } catch (e) {
    // [RC3 #64] the findUnique check above and this create are not atomic — two concurrent
    // registrations with the same username race, and the loser's create dies on the unique
    // constraint. That is a client-visible conflict (409), not a server error (500). Username
    // is the only unique field involved (email is NOT unique in the schema), so P2002 here
    // always means the username race.
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ error: 'username_taken' }, { status: 409 })
    }
    throw e
  }

  if (isMinor) {
    // Single-use confirmation token, consumed by GET /api/parental-consent/[token], which sets
    // parentalConsentAt and flips status to ACTIVE. Redis-backed, TTL'd, single-use — the same
    // atomic GETDEL pattern as Task 6's WebAuthn verified-token bridge in lib/auth.ts.
    const token = randomUUID()
    await redis.set(`parental-consent:${token}`, user.id, 'EX', 60 * 60 * 24 * 7) // 7 days
    // TODO(Phase 3): send this URL to parentalConsentEmail via lib/mailer.ts instead of logging.
    // Logged so the flow is manually testable until the mailer exists — do not remove silently.
    console.log(`Parental consent confirmation for ${username}: ${process.env.NEXTAUTH_URL}/api/parental-consent/${token}`)
  }

  return Response.json({ id: user.id, username: user.username, status: user.status }, { status: 201 })
}
