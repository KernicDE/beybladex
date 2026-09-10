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

const PRIVACY_POLICY_VERSION = '2026-09-08' // bump whenever /datenschutz's content changes materially

export async function POST(req: Request) {
  const ip = getClientIp(req) // last XFF hop — leftmost entries are client-spoofable (issue #34)
  const { allowed } = await rateLimit(`register:${ip}`, 5, 60 * 15) // 5 registrations / 15min / IP
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json()
  const username = typeof body.username === 'string' ? body.username.toLowerCase() : ''
  const { password, email, birthDate, privacyPolicyAccepted, parentalConsentEmail } = body

  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) {
    return Response.json({ error: 'invalid_username' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return Response.json({ error: 'invalid_password' }, { status: 400 })
  }
  if (!privacyPolicyAccepted) {
    return Response.json({ error: 'privacy_policy_not_accepted' }, { status: 400 })
  }
  const parsedBirthDate = new Date(birthDate)
  if (!birthDate || Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate > new Date()) {
    return Response.json({ error: 'invalid_birth_date' }, { status: 400 })
  }
  const age = calculateAge(parsedBirthDate)
  const isMinor = age < MINOR_CONSENT_AGE_THRESHOLD
  if (isMinor && (!parentalConsentEmail || typeof parentalConsentEmail !== 'string' || !parentalConsentEmail.includes('@'))) {
    return Response.json({ error: 'parental_consent_email_required' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return Response.json({ error: 'username_taken' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      email: email || null,
      birthDate: parsedBirthDate,
      isMinor,
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      status: isMinor ? 'PENDING_PARENTAL_CONSENT' : 'ACTIVE',
      parentalConsentEmail: isMinor ? parentalConsentEmail : null,
    },
  })

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
