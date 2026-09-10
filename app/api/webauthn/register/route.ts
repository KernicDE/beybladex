// app/api/webauthn/register/route.ts (GET issues a registration challenge, POST verifies it)
// Same Redis-only challenge pattern as app/api/webauthn/authenticate, but scoped to the
// already-authenticated session's userId instead of a username lookup.
import { redis } from '@/lib/redis'
import { randomUUID } from 'node:crypto'
import { auth } from '@/lib/auth'
import { getRegistrationOptions, verifyRegistration } from '@/lib/webauthn'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/getClientIp'

const CHALLENGE_TTL_SECONDS = 120

export async function GET(req: Request) {
  const ip = getClientIp(req) // last XFF hop, not the spoofable leftmost entry (issue #34)
  // [RC3 #49] fail-closed: passkey registration mints new credentials — no working limiter, no
  // registration while Redis is down.
  const { allowed } = await rateLimit(`webauthn-reg:${ip}`, 10, 60, { onRedisError: 'closed' })
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const options = await getRegistrationOptions(session.user.id)
  const nonce = randomUUID()
  await redis.set(
    `webauthn-reg-challenge:${nonce}`,
    JSON.stringify({ userId: session.user.id, challenge: options.challenge }),
    'EX',
    CHALLENGE_TTL_SECONDS
  )

  return Response.json({ options, nonce })
}

export async function POST(req: Request) {
  const ip = getClientIp(req) // last XFF hop, not the spoofable leftmost entry (issue #34)
  // [RC3 #49] fail-closed: passkey registration mints new credentials — no working limiter, no
  // registration while Redis is down.
  const { allowed } = await rateLimit(`webauthn-reg:${ip}`, 10, 60, { onRedisError: 'closed' })
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const { nonce, response } = parsedBody as {
    nonce?: unknown
    response: Parameters<typeof verifyRegistration>[1]
  }
  const raw = await redis.get(`webauthn-reg-challenge:${nonce}`)
  if (!raw) return Response.json({ error: 'challenge_expired_or_used' }, { status: 400 })
  await redis.del(`webauthn-reg-challenge:${nonce}`) // single-use: delete before verifying, not after

  const { userId, challenge } = JSON.parse(raw)
  if (userId !== session.user.id) return Response.json({ error: 'challenge_user_mismatch' }, { status: 403 })

  const verified = await verifyRegistration(userId, response, challenge)
  if (!verified) return Response.json({ error: 'verification_failed' }, { status: 400 })

  return Response.json({ verified: true }, { status: 201 })
}
