// app/api/register/route.ts
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

// [REVIEW-FIX: backend-security #7] username policy: 3-20 chars, ASCII alphanumeric + underscore,
// case-insensitive uniqueness (stored lowercase, displayName preserves original casing separately
// if a later phase adds one), reserved-name blocklist so routes like /profile/api can't be squatted.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const RESERVED_USERNAMES = new Set(['admin', 'api', 'root', 'support', 'moderator', 'beybladex'])
const MINOR_CONSENT_AGE_THRESHOLD = 16 // Germany's GDPR Art. 8 threshold — the highest in DACH; using
// the strictest applicable threshold for all three countries is the only choice that's correct
// everywhere without per-country legal branching.

const PRIVACY_POLICY_VERSION = '2026-09-08' // bump whenever /datenschutz's content changes materially

function calculateAge(birthDate: Date, now = new Date()): number {
  let age = now.getFullYear() - birthDate.getFullYear()
  const monthDiff = now.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age--
  return age
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
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
    // Send a one-time confirmation link to parentalConsentEmail (mailer mechanism decided in
    // Phase 3, same infrastructure as notifyEmail — see that phase's [REVIEW-FIX] note); the
    // link, on click, sets parentalConsentAt and flips status to ACTIVE. Until confirmed, login
    // is refused (wired into lib/auth.ts's authorize(), alongside the TOTP gate) with a
    // clear message. This route only creates the pending account and (conceptually) triggers the
    // email; the confirmation endpoint itself is `app/api/parental-consent/[token]/route.ts`,
    // token-based (Redis-backed, TTL'd, single-use, same pattern as Task 6's WebAuthn challenges).
  }

  return Response.json({ id: user.id, username: user.username, status: user.status }, { status: 201 })
}
