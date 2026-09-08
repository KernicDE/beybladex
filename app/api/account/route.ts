// app/api/account/route.ts
// DELETE, owner-only — GDPR Art. 17 erasure. Requires re-confirmation in the request body:
// either the current password (bcrypt-verified) or a valid current TOTP token — same
// two-factor policy as login itself. Delegates the actual erasure/anonymization matrix to
// lib/accountErasure.ts, the single place every later User-owned model must be registered.
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { eraseOrAnonymizeUser } from '@/lib/accountErasure'

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  // Account deletion is auth-adjacent and irreversible — tight per-user rate limit.
  const { allowed } = await rateLimit(`account-delete:${userId}`, 5, 3600)
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

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return Response.json({ error: 'not_found' }, { status: 404 })

  let confirmed = false
  if (typeof fields.password === 'string' && fields.password) {
    if (!user.passwordHash) {
      return Response.json({ error: 'password_not_set' }, { status: 400 })
    }
    confirmed = await bcrypt.compare(fields.password, user.passwordHash)
    if (!confirmed) return Response.json({ error: 'invalid_credentials' }, { status: 403 })
  } else if (typeof fields.totpToken === 'string' && fields.totpToken) {
    if (!user.totpSecret) {
      return Response.json({ error: 'totp_not_enabled' }, { status: 400 })
    }
    const { verifyTotp } = await import('@/lib/totp')
    const { decryptSecret } = await import('@/lib/totpEncryption')
    confirmed = verifyTotp(decryptSecret(user.totpSecret), fields.totpToken)
    if (!confirmed) return Response.json({ error: 'invalid_credentials' }, { status: 403 })
  } else {
    return Response.json({ error: 'confirmation_required' }, { status: 400 })
  }

  await eraseOrAnonymizeUser(userId)

  return Response.json({ deleted: true }, { status: 200 })
}
