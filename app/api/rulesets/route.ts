// app/api/rulesets/route.ts
// POST — create a Ruleset. AUTHZ RULE (standing Global-Constraints requirement): a session
// is required (401 otherwise) and createdById is ALWAYS taken from the session — the body
// can never nominate an owner. Rate-limited per user.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { slugify, uniqueSlug } from '@/lib/slug'
import { parseRulesetInput } from '@/lib/rulesetValidation'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`rulesets:create:${session.user.id}`, 20, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { data, errors } = parseRulesetInput(body, false)
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })

  const base = slugify(data.title as string)
  const slug = await uniqueSlug(base, async (s) => (await prisma.ruleset.findUnique({ where: { slug: s } })) !== null)

  const ruleset = await prisma.ruleset.create({
    data: { ...data, slug, createdById: session.user.id },
  })

  return Response.json(
    { id: ruleset.id, slug: ruleset.slug, title: ruleset.title },
    { status: 201 },
  )
}
