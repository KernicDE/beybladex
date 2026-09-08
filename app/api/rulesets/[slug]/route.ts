// app/api/rulesets/[slug]/route.ts
// GET — public when isPublic = true; when private, only the owner may read it and everyone
// else gets 404 (NOT 403 — a private ruleset's existence is not leaked; same policy as the
// view page and Phase 3+ collection rules).
// PATCH — AUTHZ RULE (standing Global-Constraints requirement): only the row's createdById
// may modify it; any other authenticated caller gets 403 (proven by a negative test), and
// anonymous callers get 401. Whitelisted fields only; the slug is immutable.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseRulesetInput } from '@/lib/rulesetValidation'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  const session = await auth()

  const ruleset = await prisma.ruleset.findUnique({ where: { slug } })
  if (!ruleset) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!ruleset.isPublic && ruleset.createdById !== session?.user?.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  return Response.json(ruleset, { status: 200 })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`rulesets:patch:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { slug } = await ctx.params
  const existing = await prisma.ruleset.findUnique({ where: { slug } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })
  if (existing.createdById !== session.user.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { data, errors } = parseRulesetInput(body, true)
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })

  const ruleset = await prisma.ruleset.update({ where: { slug }, data })
  return Response.json(ruleset, { status: 200 })
}
