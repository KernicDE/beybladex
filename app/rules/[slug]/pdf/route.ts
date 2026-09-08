// app/rules/[slug]/pdf/route.ts
// Streams the ruleset as application/pdf. Same visibility as the view page: public when
// isPublic = true, owner-only otherwise, 404 (NOT 403) for everyone else — a private
// ruleset's existence is never leaked. Server-side rendering only (lib/rulesetPdf.ts);
// react-pdf's fonts are bundled, so the response involves zero external requests.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { buildRulesetPdf } from '@/lib/rulesetPdf'

export const runtime = 'nodejs' // react-pdf needs the Node runtime, not the Edge runtime

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const session = await auth()

  const ruleset = await prisma.ruleset.findUnique({
    where: { slug },
    include: { createdBy: { select: { username: true } } },
  })
  if (!ruleset) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!ruleset.isPublic && ruleset.createdById !== session?.user?.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const pdf = await buildRulesetPdf(ruleset, ruleset.createdBy.username)

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${ruleset.slug}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
