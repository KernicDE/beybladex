// app/api/webauthn/authenticate/route.ts (GET issues a challenge, POST verifies it)
import { redis } from '@/lib/redis'
import { randomUUID } from 'node:crypto'
import { getAuthenticationOptions, verifyAuthentication } from '@/lib/webauthn'
import { signIn } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

const CHALLENGE_TTL_SECONDS = 120

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const { allowed } = await rateLimit(`webauthn-auth:${ip}`, 10, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const username = new URL(req.url).searchParams.get('username')?.toLowerCase()
  if (!username) return Response.json({ error: 'missing_username' }, { status: 400 })

  const options = await getAuthenticationOptions(username)
  const nonce = randomUUID()
  // Bind the challenge to both the username and a single-use nonce; TTL bounds the attack window.
  await redis.set(`webauthn-challenge:${nonce}`, JSON.stringify({ username, challenge: options.challenge }), 'EX', CHALLENGE_TTL_SECONDS)

  return Response.json({ options, nonce })
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const { allowed } = await rateLimit(`webauthn-auth:${ip}`, 10, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { nonce, response } = await req.json()
  const raw = await redis.get(`webauthn-challenge:${nonce}`)
  if (!raw) return Response.json({ error: 'challenge_expired_or_used' }, { status: 400 })
  await redis.del(`webauthn-challenge:${nonce}`) // single-use: delete before verifying, not after

  const { username, challenge } = JSON.parse(raw)
  const verification = await verifyAuthentication(response, challenge)
  if (!verification.verified) return Response.json({ error: 'verification_failed' }, { status: 401 })

  // Mint a real NextAuth session now that the passkey ceremony succeeded: a single-use,
  // short-lived Redis "verified" token consumed by lib/auth.ts's second authorize branch
  // (credentials.webauthnToken). POST succeeds only after Redis-verified challenge consumption,
  // and signIn sets the same httpOnly/SameSite=Strict session cookie password login does.
  const user = await prisma.user.findUniqueOrThrow({ where: { username } })
  const webauthnToken = randomUUID()
  await redis.set(`webauthn-verified:${webauthnToken}`, username, 'EX', 60)
  await signIn('credentials', { webauthnToken, redirect: false })

  return Response.json({ userId: user.id, username: user.username }, { status: 200 })
}
