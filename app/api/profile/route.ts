// app/api/profile/route.ts
// PATCH, owner-only — GDPR Art. 16 rectification. Whitelisted fields only; anything else in
// the body is ignored. Authorization: the session IS the owner boundary (a caller can only
// ever edit their own row); a body that explicitly names a different userId is rejected with
// 403 rather than silently editing the caller's own row.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { calculateAge, MINOR_CONSENT_AGE_THRESHOLD } from '@/lib/age'
import { BIO_MAX } from '@/lib/markdownFieldCaps'

// Free-text length caps — the bio/displayName convention every later phase's forms follow.
const DISPLAY_NAME_MAX = 50
const LOCATION_MAX = 100
const POSTAL_CODE_MAX = 10
const DISCORD_TAG_MAX = 100
const COUNTRIES = ['DE', 'AT', 'CH'] as const

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`profile-patch:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const fields = body as Record<string, unknown>

  if (fields.userId !== undefined && fields.userId !== session.user.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const data: Record<string, unknown> = {}

  const takeString = (key: string, max: number): string | null | 'invalid' | undefined => {
    const value = fields[key]
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value !== 'string' || value.length > max) return 'invalid'
    return value
  }

  for (const key of ['displayName', 'bio', 'city', 'state', 'discordTag'] as const) {
    const v = takeString(key, key === 'bio' ? BIO_MAX : key === 'displayName' ? DISPLAY_NAME_MAX : key === 'discordTag' ? DISCORD_TAG_MAX : LOCATION_MAX)
    if (v === 'invalid') return Response.json({ error: `invalid_${key}` }, { status: 400 })
    if (v !== undefined) data[key] = v
  }

  {
    const v = takeString('postalCode', POSTAL_CODE_MAX)
    if (v === 'invalid') return Response.json({ error: 'invalid_postalCode' }, { status: 400 })
    if (v !== undefined) data.postalCode = v
  }

  if (fields.country !== undefined) {
    if (fields.country !== null && !COUNTRIES.includes(fields.country as (typeof COUNTRIES)[number])) {
      return Response.json({ error: 'invalid_country' }, { status: 400 })
    }
    data.country = fields.country
  }

  if (fields.birthDate !== undefined) {
    const parsed = new Date(fields.birthDate as string)
    if (
      typeof fields.birthDate !== 'string' ||
      Number.isNaN(parsed.getTime()) ||
      parsed > new Date()
    ) {
      return Response.json({ error: 'invalid_birth_date' }, { status: 400 })
    }
    data.birthDate = parsed
    // A birthDate edit re-runs the Task 5 age computation and updates isMinor.
    // Deliberate asymmetry (Task 12), do NOT "fix" this into a consent re-run: an edit that
    // LOWERS the computed age (a correction demoting an adult to a minor) is accepted as-is —
    // minors deserve the protection even if self-reported late, and the account can simply be
    // re-flagged. An edit RAISING the age past the consent threshold does not require a new
    // parental-consent flow either: becoming LESS restricted is never the harm Art. 8 guards
    // against, so the gate only ever blocks downward exposure, which the minor ceilings in
    // lib/privacy.ts enforce server-side regardless of this flag.
    data.isMinor = calculateAge(parsed) < MINOR_CONSENT_AGE_THRESHOLD
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'no_fields' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      displayName: true, bio: true, city: true, postalCode: true, state: true, country: true,
      discordTag: true, birthDate: true, isMinor: true,
    },
  })

  return Response.json(user, { status: 200 })
}
