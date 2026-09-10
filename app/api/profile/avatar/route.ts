// app/api/profile/avatar/route.ts (Phase 21, items 1 + 2)
// Upload/replace (POST) or remove (DELETE) the session user's OWN profile photo via the
// generic media pipeline (lib/media.ts, AVATAR_TARGET). Modeled directly on
// app/api/tournaments/[id]/header-image/route.ts.
// AUTHZ RULE (standing Global-Constraints requirement): session-required, self-only — a user
// only ever sets or clears their OWN avatar; there is no target-user parameter, so a session
// is the entire authorization scope. Replacing an existing avatar leaves the old MediaAsset
// row/file orphaned (same documented tradeoff as the header-image and admin-parts-image
// routes) — only the explicit DELETE and account erasure free the asset.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { AVATAR_TARGET, processAndStoreImage, isUploadedFile } from '@/lib/media'

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`profile:avatar:${session.user.id}`, 30, 60 * 60)
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
    const asset = await processAndStoreImage(file, AVATAR_TARGET, session.user.id)
    assetId = asset.id
  } catch (err) {
    const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
    return Response.json({ error: token }, { status: 400 })
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { avatarImageId: assetId } })
  return Response.json({ avatarImageId: assetId }, { status: 200 })
}

export async function DELETE(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`profile:avatar:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  // Clear the reference back to null; the MediaAsset row/file stays orphaned — same
  // documented tradeoff as replacing an upload. Account erasure (lib/accountErasure.ts)
  // is the one place an avatar's asset is explicitly deleted.
  await prisma.user.update({ where: { id: session.user.id }, data: { avatarImageId: null } })
  return Response.json({ avatarImageId: null }, { status: 200 })
}
