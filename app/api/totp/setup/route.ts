// app/api/totp/setup/route.ts
// Owner-only: returns a QR code for a FRESH secret. The secret is NOT persisted here — it lives
// as a "pending" value in Redis (TTL'd) until confirmed via POST /api/totp/verify, which is the
// only path that writes user.totpSecret (encrypted at rest — see lib/totpEncryption.ts).
import QRCode from 'qrcode'
import { auth } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { generateTotpSecret } from '@/lib/totp'
import { rateLimit } from '@/lib/rateLimit'

const PENDING_TTL_SECONDS = 300

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !session.user.name) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`totp-setup:${session.user.id}`, 5, 300)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { secret, otpauthUrl } = generateTotpSecret(session.user.name)
  await redis.set(`totp-pending:${session.user.id}`, secret, 'EX', PENDING_TTL_SECONDS)

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
  return Response.json({ otpauthUrl, qrCodeDataUrl }, { status: 200 })
}
