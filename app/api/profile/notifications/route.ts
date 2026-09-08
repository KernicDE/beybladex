// app/api/profile/notifications/route.ts
// PATCH, owner-only: the three notification preference fields (Phase 3's radius search and
// lib/notify.ts consume these). postalCode/city/country live on PATCH /api/profile instead —
// this route deliberately owns ONLY notify* fields so the two routes never overlap.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

const NOTIFY_RADIUS_MIN_KM = 1
const NOTIFY_RADIUS_MAX_KM = 500

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`notifications-patch:${session.user.id}`, 30, 60)
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

  const data: Record<string, unknown> = {}

  if (fields.notifyRadiusKm !== undefined) {
    const radius = fields.notifyRadiusKm
    if (
      typeof radius !== 'number' ||
      !Number.isInteger(radius) ||
      radius < NOTIFY_RADIUS_MIN_KM ||
      radius > NOTIFY_RADIUS_MAX_KM
    ) {
      return Response.json({ error: 'invalid_notifyRadiusKm' }, { status: 400 })
    }
    data.notifyRadiusKm = radius
  }
  for (const key of ['notifyRecurring', 'notifyEmail'] as const) {
    if (fields[key] !== undefined) {
      if (typeof fields[key] !== 'boolean') {
        return Response.json({ error: `invalid_${key}` }, { status: 400 })
      }
      data[key] = fields[key]
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'no_fields' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { notifyRadiusKm: true, notifyRecurring: true, notifyEmail: true },
  })

  return Response.json(user, { status: 200 })
}
