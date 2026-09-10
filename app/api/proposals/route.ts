// app/api/proposals/route.ts
// Catalog proposals (Phase 11, item 1) — replaces PartRequest's free-text flow with a
// structured shape covering a new Part OR a new official Build/Set.
// POST — any logged-in user (USER tier and above) may submit; multipart FormData carries the
//        fields plus an optional image file (item 0's pipeline, PART_IMAGE_TARGET for both
//        kinds — Set images use the same square catalog crop). The payload is validated by
//        kind (lib/proposalValidation.ts), never accepted as opaque JSON; BUILD slots
//        referencing existing Part.ids are verified for existence AND slot category here,
//        inline-new parts are stored in the payload for the reviewer to approve.
//        AUTHZ RULE (standing Global-Constraints requirement): a session is required —
//        anonymous gets 401 (negative test in tests/integration/catalog-proposal-flow.test.ts).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { PART_IMAGE_TARGET, mediaFilePath, processAndStoreImage } from '@/lib/media'
import { parsePartProposalPayload, parseBuildProposalPayload } from '@/lib/proposalValidation'
import { unlink } from 'node:fs/promises'

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`proposals:create:${session.user.id}`, 20, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const ctype = req.headers.get('content-type') ?? ''
  if (!ctype.includes('multipart/form-data')) {
    return Response.json({ error: 'invalid_content_type' }, { status: 400 })
  }
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }

  const kind = form.get('kind')
  if (kind !== 'PART' && kind !== 'BUILD') {
    return Response.json({ error: 'invalid_kind' }, { status: 400 })
  }

  // Flatten the FormData into a plain body (nested BUILD slots arrive as JSON strings).
  const body: Record<string, unknown> = {}
  for (const [key, value] of form.entries()) {
    if (value instanceof File) continue
    body[key] = key === 'slots' && typeof value === 'string' ? safeJson(value) : value
  }

  const parsed =
    kind === 'PART'
      ? parsePartProposalPayload(body)
      : parseBuildProposalPayload(body)
  if (parsed.errors) return Response.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 })

  // Verify BUILD slots that reference existing catalog parts (existence + slot category).
  if (kind === 'BUILD') {
    const payload = parsed.data as import('@/lib/proposalValidation').BuildProposalPayload
    const refs = Object.values(payload.slots).map((s) => s.partId).filter((id): id is string => id !== null)
    if (refs.length > 0) {
      const found = await prisma.part.findMany({ where: { id: { in: refs } }, select: { id: true, category: true } })
      const byId = new Map(found.map((p) => [p.id, p.category]))
      const slotCategory = { blade: 'BLADE', ratchet: 'RATCHET', bit: 'BIT' } as const
      for (const [slot, s] of Object.entries(payload.slots)) {
        if (s.partId && byId.get(s.partId) !== slotCategory[slot as keyof typeof slotCategory]) {
          return Response.json({ error: `invalid_slot_${slot}` }, { status: 400 })
        }
      }
    }
  }

  // Optional image upload through the generic pipeline. The asset row is created first; if
  // the proposal insert fails the orphaned asset is removed (no dangling volume file).
  const imageFile = form.get('image')
  let imageAssetId: string | null = null
  if (imageFile instanceof File && imageFile.size > 0) {
    try {
      const asset = await processAndStoreImage(imageFile, PART_IMAGE_TARGET, session.user.id)
      imageAssetId = asset.id
    } catch (err) {
      const token = err instanceof Error && err.message === 'invalid_file_type' ? 'invalid_image_type' : 'invalid_image'
      return Response.json({ error: token }, { status: 400 })
    }
  }

  try {
    const proposal = await prisma.catalogProposal.create({
      data: {
        kind,
        submittedById: session.user.id,
        payload: parsed.data as object,
        imageAssetId,
      },
      select: { id: true },
    })
    return Response.json({ id: proposal.id }, { status: 201 })
  } catch (err) {
    if (imageAssetId) {
      // Roll back both halves of the upload: the DB row and the volume file.
      await prisma.mediaAsset.delete({ where: { id: imageAssetId } }).catch(() => {})
      await unlink(mediaFilePath(imageAssetId)).catch(() => {})
    }
    throw err
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
