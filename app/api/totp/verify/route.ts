// app/api/totp/verify/route.ts
// Owner-only enrollment confirmation: verifies the submitted token against the PENDING secret
// issued by GET /api/totp/setup and, only on success, persists encryptSecret(secret) to
// user.totpSecret. This is distinct from the login-time gate in lib/auth.ts's authorize().
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { verifyTotp } from '@/lib/totp'
import { encryptSecret } from '@/lib/totpEncryption'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`totp-verify:${session.user.id}`, 5, 300)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const { token } = parsedBody as { token?: unknown }
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) {
    return Response.json({ error: 'invalid_token' }, { status: 400 })
  }

  const pendingSecret = await redis.get(`totp-pending:${session.user.id}`)
  if (!pendingSecret) return Response.json({ error: 'setup_expired' }, { status: 400 })

  if (!verifyTotp(pendingSecret, token)) {
    return Response.json({ error: 'invalid_token' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: encryptSecret(pendingSecret) },
  })
  await redis.del(`totp-pending:${session.user.id}`)

  return Response.json({ verified: true }, { status: 200 })
}
