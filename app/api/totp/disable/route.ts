// app/api/totp/disable/route.ts
// POST, owner-only: disables TOTP 2FA. Password re-confirmation is REQUIRED — disabling the
// second factor must never be possible with only the session cookie (a stolen cookie is one
// factor; this route demands the other). Rate-limited per user, like every auth-adjacent route.
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`totp-disable:${session.user.id}`, 5, 300)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const password = (body as Record<string, unknown>)?.password
  if (typeof password !== 'string' || !password) {
    return Response.json({ error: 'password_required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user?.passwordHash || !user.totpSecret) {
    return Response.json({ error: 'totp_not_enabled' }, { status: 400 })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return Response.json({ error: 'invalid_password' }, { status: 403 })

  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null } })

  return Response.json({ disabled: true }, { status: 200 })
}
