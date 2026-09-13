// app/api/admin/builds/[id]/image/route.ts (RC16 #108)
// Upload/replace a Build/Set's image via the generic media pipeline (lib/media.ts,
// BUILD_IMAGE_TARGET). Mirrors app/api/admin/parts/[id]/image/route.ts: the canonical curator
// tier TRUSTED/JUDGE/ORGANIZER/ADMIN (lib/guards.ts requireCurator) — a JUDGE/ORGANIZER who
// may edit a Build's data must not get an arbitrary 403 on its image. Replacing an existing
// image leaves the OLD MediaAsset row/file orphaned (same accepted tradeoff as parts — no
// other row references it once Build.imageId is repointed).
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { BUILD_IMAGE_TARGET, processAndStoreImage } from '@/lib/media'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`builds:image:${gate.userId}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  const build = await prisma.build.findUnique({ where: { id }, select: { id: true } })
  if (!build) return Response.json({ error: 'not_found' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }
  const file = form.get('image')
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'invalid_image' }, { status: 400 })
  }

  let assetId: string
  try {
    const asset = await processAndStoreImage(file, BUILD_IMAGE_TARGET, gate.userId)
    assetId = asset.id
  } catch (err) {
    const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
    return Response.json({ error: token }, { status: 400 })
  }

  await prisma.build.update({ where: { id }, data: { imageId: assetId } })
  return Response.json({ imageId: assetId }, { status: 200 })
}
