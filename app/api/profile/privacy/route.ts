// app/api/profile/privacy/route.ts
// PATCH, owner-only: updates the user's own visibility settings. The minor ceilings in
// lib/privacy.ts are enforced at read time (resolveVisibleFields), so a minor setting a wider
// value here simply has no effect on what non-owners see.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const VISIBILITY_FIELDS = [
  'profileVisibility',
  'locationVisibility',
  'collectionVisibility',
  'decksVisibility',
  'ageVisibility',
] as const

const PRIVACY_LEVELS = ['PUBLIC', 'FRIENDS_ONLY', 'PRIVATE'] as const

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const data: Record<string, (typeof PRIVACY_LEVELS)[number]> = {}
  for (const field of VISIBILITY_FIELDS) {
    const value = (body as Record<string, unknown>)[field]
    if (value === undefined) continue
    if (!PRIVACY_LEVELS.includes(value as (typeof PRIVACY_LEVELS)[number])) {
      return Response.json({ error: `invalid_${field}` }, { status: 400 })
    }
    data[field] = value as (typeof PRIVACY_LEVELS)[number]
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'no_fields' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      profileVisibility: true,
      locationVisibility: true,
      collectionVisibility: true,
      decksVisibility: true,
      ageVisibility: true,
    },
  })

  return Response.json(user, { status: 200 })
}
