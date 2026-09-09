// app/api/parts/request/route.ts
// POST — "request missing part": any logged-in user can ask for a part the catalog doesn't
// have yet (name + manufacturer guess + notes). Lands in the admin/TRUSTED queue rendered on
// app/settings/admin/parts. Rate-limited per user.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parsePartRequestInput } from '@/lib/partValidation'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`parts:request:${session.user.id}`, 10, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { data, errors } = parsePartRequestInput(body)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const request = await prisma.partRequest.create({
    data: { ...data!, requestedById: session.user.id },
  })
  return Response.json({ id: request.id }, { status: 201 })
}
