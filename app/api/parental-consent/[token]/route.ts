// app/api/parental-consent/[token]/route.ts
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Single-use token: GETDEL consumes it atomically, so a replayed or expired
  // link is indistinguishable from a never-issued one — same pattern as the
  // WebAuthn verified-token bridge in lib/auth.ts.
  const userId = await redis.getdel(`parental-consent:${token}`)
  if (!userId) {
    return Response.json({ error: 'invalid_or_expired_token' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: userId },
    data: { parentalConsentAt: new Date(), status: 'ACTIVE' },
  })

  // TODO(Phase 3): once lib/mailer.ts exists and a confirmation-UI page ships,
  // redirect to that page instead of returning a bare JSON confirmation.
  return Response.json({ ok: true })
}
