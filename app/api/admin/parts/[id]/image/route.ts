// app/api/admin/parts/[id]/image/route.ts (Phase 11, item 3/4)
// Upload/replace a catalog Part's image via the generic media pipeline (lib/media.ts,
// PART_IMAGE_TARGET). AUTHZ RULE (standing Global-Constraints requirement): the canonical
// curator tier TRUSTED/JUDGE/ORGANIZER/ADMIN (lib/guards.ts requireCurator). Issue #42 widened
// this together with the rest of /api/admin/parts: a JUDGE/ORGANIZER who may edit a Part's data
// must not get an arbitrary 403 on its image — one tier for all of parts curation, defined in
// lib/roles.ts CURATOR_ROLES. Replacing an existing image leaves the OLD MediaAsset row/file
// orphaned (acceptable — no other row references it once Part.imageId is repointed; a future
// cleanup pass could sweep unreferenced assets, out of scope here) rather than risk deleting
// a file another in-flight request still reads.
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { PART_IMAGE_TARGET, processAndStoreImage } from '@/lib/media'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`parts:image:${gate.userId}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  const part = await prisma.part.findUnique({ where: { id }, select: { id: true } })
  if (!part) return Response.json({ error: 'not_found' }, { status: 404 })

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
    const asset = await processAndStoreImage(file, PART_IMAGE_TARGET, gate.userId)
    assetId = asset.id
  } catch (err) {
    const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
    return Response.json({ error: token }, { status: 400 })
  }

  await prisma.part.update({ where: { id }, data: { imageId: assetId } })
  return Response.json({ imageId: assetId }, { status: 200 })
}
