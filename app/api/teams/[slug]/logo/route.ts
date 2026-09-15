// app/api/teams/[slug]/logo/route.ts (issue #198)
// Upload/replace (POST) or remove (DELETE) a team's crest/logo via the generic media pipeline
// (lib/media.ts, TEAM_LOGO_TARGET). Modeled on app/api/profile/avatar/route.ts, but the
// authorization scope is CAPTAIN-tier (lib/teamAuth.ts) instead of self-only — a team logo is
// a shared team asset, not a personal one.
import { rateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/guards'
import { authorizeTeamCaptain } from '@/lib/teamAuth'
import { TEAM_LOGO_TARGET, processAndStoreImage, isUploadedFile } from '@/lib/media'

type Ctx = { params: Promise<{ slug: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { slug } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error

  const { allowed } = await rateLimit(`team:logo:${gate.userId}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }
  const file = form.get('image')
  if (!isUploadedFile(file) || file.size === 0) {
    return Response.json({ error: 'invalid_image' }, { status: 400 })
  }

  let assetId: string
  try {
    const asset = await processAndStoreImage(file, TEAM_LOGO_TARGET, gate.userId)
    assetId = asset.id
  } catch (err) {
    const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
    return Response.json({ error: token }, { status: 400 })
  }

  await prisma.team.update({ where: { id: authz.team.id }, data: { logoImageId: assetId } })
  return Response.json({ logoImageId: assetId }, { status: 200 })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { slug } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error

  const { allowed } = await rateLimit(`team:logo:${gate.userId}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  await prisma.team.update({ where: { id: authz.team.id }, data: { logoImageId: null } })
  return Response.json({ logoImageId: null }, { status: 200 })
}
