// app/api/tournaments/[id]/header-image/route.ts (Phase 11, item 5)
// Upload/replace an event's header image via the generic media pipeline (lib/media.ts,
// EVENT_HEADER_TARGET). AUTHZ RULE (standing Global-Constraints requirement): the tournament's
// organizer (createdById) or an ADMIN — same tier as every other organizer-console action
// (Phase 5 Part C's judge-assign, Phase 7's arena/payment actions). Replacing an existing
// header image leaves the old MediaAsset row/file orphaned (same documented tradeoff as
// /api/admin/parts/[id]/image).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { EVENT_HEADER_TARGET, processAndStoreImage, isUploadedFile } from '@/lib/media'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const { allowed } = await rateLimit(`tournaments:header-image:${session.user.id}`, 30, 60 * 60)
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
    const asset = await processAndStoreImage(file, EVENT_HEADER_TARGET, session.user.id)
    assetId = asset.id
  } catch (err) {
    const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
    return Response.json({ error: token }, { status: 400 })
  }

  await prisma.tournament.update({ where: { id }, data: { headerImageId: assetId } })
  return Response.json({ headerImageId: assetId }, { status: 200 })
}
