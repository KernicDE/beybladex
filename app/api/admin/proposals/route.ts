// app/api/admin/proposals/route.ts
// Catalog-proposal review (Phase 11, item 1) — replaces PartRequestQueue's settle endpoint.
// PATCH — approve or reject a pending CatalogProposal.
//   AUTHZ RULE (standing Global-Constraints requirement): TRUSTED/JUDGE/ORGANIZER/ADMIN only
//   (the widened reviewer tier — negative test for plain USER in
//   tests/integration/catalog-proposal-flow.test.ts).
//   APPROVE → kind=PART creates the Part row from the validated payload; kind=BUILD creates
//   any inline-new Part rows plus the official Build (isOfficialSet=true, Set name) in ONE
//   transaction — unless the combo (bladeId+ratchetId+bitId) already exists, in which case the
//   transaction answers 409 combo_exists with the EXISTING Build's id (Phase 20 graceful
//   pre-check, never a raw unique-constraint 500). Either kind links the proposal's uploaded
//   MediaAsset (Part.imageId / Build.imageId) and writes an append-only AuditLog row.
//   REJECT → requires a reviewNote (returned to the submitter); sets status + note.
//   Either outcome notifies the submitter via lib/notify.ts's notifyUser.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { notifyUser } from '@/lib/notify'
import { isCurator } from '@/lib/roles'
import { PROPOSAL_SLOT_CATEGORIES, type BuildProposalPayload, type InlinePartPayload } from '@/lib/proposalValidation'
import type { Manufacturer, PartCategory, BeyType, SpinDirection } from '@prisma/client'

const STATUSES = ['APPROVED', 'REJECTED'] as const
type SettleStatus = (typeof STATUSES)[number]

// Phase 20 — thrown inside the approval transaction when the proposed combo already backs a
// Build row; the route catches it and answers with the existing Build's id (graceful 409
// combo_exists) instead of a raw unique-constraint 500 or a second row.
class ComboExistsError extends Error {
  constructor(readonly buildId: string) {
    super('combo_exists')
  }
}

type CuratorGate = { error: Response } | { actorId: string }

async function requireCurator(): Promise<CuratorGate> {
  const session = await auth()
  if (!session?.user?.id) return { error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (!isCurator(caller?.role)) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { actorId: session.user.id }
}

interface InlinePartCreate {
  name: string
  manufacturer: Manufacturer
  category: PartCategory
  beyType: BeyType | null
  spinDirection: SpinDirection
  weightGrams: number | null
}

function inlinePartData(inline: InlinePartPayload, category: PartCategory): InlinePartCreate {
  return {
    name: inline.name,
    manufacturer: inline.manufacturer,
    category,
    beyType: inline.beyType,
    spinDirection: inline.spinDirection,
    weightGrams: inline.weightGrams,
  }
}

// GET — list PENDING proposals for the review queue (rendered by ProposalQueue). Curator-only,
// same tier as PATCH. Deliberately unbounded-but-capped at 100 — a real backlog this large
// would need pagination, but a pending queue is meant to stay small by design (standing
// small-collection exception, like a club roster).
export async function GET(): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error

  const proposals = await prisma.catalogProposal.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { submittedBy: { select: { username: true } } },
  })
  return Response.json({
    proposals: proposals.map((p) => ({
      id: p.id,
      kind: p.kind,
      payload: p.payload,
      imageAssetId: p.imageAssetId,
      submittedBy: p.submittedBy.username,
      createdAt: p.createdAt.toISOString(),
    })),
  })
}

export async function PATCH(req: Request): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`proposals:review:${gate.actorId}`, 120, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const id = typeof b?.id === 'string' ? b.id : null
  const status: SettleStatus | null = STATUSES.includes(b?.status as SettleStatus) ? (b.status as SettleStatus) : null
  const reviewNote = typeof b?.reviewNote === 'string' && b.reviewNote.trim() !== '' ? b.reviewNote.trim().slice(0, 500) : null
  if (!id || !status) return Response.json({ error: 'invalid_body' }, { status: 400 })
  if (status === 'REJECTED' && !reviewNote) return Response.json({ error: 'reviewNote_required' }, { status: 400 })

  const proposal = await prisma.catalogProposal.findUnique({ where: { id } })
  if (!proposal) return Response.json({ error: 'not_found' }, { status: 404 })
  if (proposal.status !== 'PENDING') return Response.json({ error: 'already_reviewed' }, { status: 409 })

  if (status === 'REJECTED') {
    await prisma.$transaction(async (tx) => {
      await tx.catalogProposal.update({
        where: { id },
        data: { status: 'REJECTED', reviewNote, reviewedById: gate.actorId, reviewedAt: new Date() },
      })
      await tx.auditLog.create({
        data: {
          actorId: gate.actorId,
          action: 'catalog_proposal.reject',
          targetType: 'catalog_proposal',
          targetId: id,
          summary: `Katalog-Vorschlag ${id} abgelehnt`,
        },
      })
    })
    await notifyUser(proposal.submittedById, {
      title: 'Katalog-Vorschlag abgelehnt',
      message: `Dein Vorschlag wurde abgelehnt.${reviewNote ? ` Begründung: ${reviewNote}` : ''}`,
      link: '/collection',
    })
    return Response.json({ id, status }, { status: 200 })
  }

  // APPROVE — everything below happens in ONE transaction: inline parts + build (or the
  // standalone part), the proposal status flip, and the audit row. A payload that fails
  // verification mid-transaction rolls the whole approval back.
  try {
    const result = await prisma.$transaction(async (tx) => {
      let createdPartId: string | null = null
      let createdBuildId: string | null = null

      if (proposal.kind === 'PART') {
        const payload = proposal.payload as unknown as import('@/lib/proposalValidation').PartProposalPayload
        const part = await tx.part.create({
          data: {
            name: payload.name,
            manufacturer: payload.manufacturer,
            category: payload.category,
            beyType: payload.beyType ?? null,
            spinDirection: payload.spinDirection,
            weightGrams: payload.weightGrams ?? null,
            imageId: proposal.imageAssetId,
          },
        })
        createdPartId = part.id
      } else {
        const payload = proposal.payload as unknown as BuildProposalPayload
        const slotPartIds: Record<string, string> = {}
        for (const [slot, category] of Object.entries(PROPOSAL_SLOT_CATEGORIES)) {
          const s = payload.slots[slot as keyof BuildProposalPayload['slots']]
          if (!s) throw new Error(`invalid_slot_${slot}`)
          if (s.partId) {
            // Re-verify at approval time (the catalog may have changed since submission).
            const part = await tx.part.findUnique({ where: { id: s.partId }, select: { id: true, category: true } })
            if (!part || part.category !== category) throw new Error(`invalid_slot_${slot}`)
            slotPartIds[slot] = part.id
          } else if (s.inline) {
            const part = await tx.part.create({ data: { ...inlinePartData(s.inline, category), imageId: null } })
            slotPartIds[slot] = part.id
          } else {
            throw new Error(`invalid_slot_${slot}`)
          }
        }
        // Phase 20 duplicate-combo pre-check: the same three parts must never back two Build
        // rows. The Set name is curator-entered retail data (required by the payload parser)
        // and is therefore kept verbatim — never overridden by a canonical derivation.
        const combo = { bladeId: slotPartIds.blade!, ratchetId: slotPartIds.ratchet!, bitId: slotPartIds.bit! }
        const existingCombo = await tx.build.findUnique({
          where: { bladeId_ratchetId_bitId: combo },
          select: { id: true },
        })
        if (existingCombo) throw new ComboExistsError(existingCombo.id)
        const build = await tx.build.create({
          data: {
            ...combo,
            name: payload.name,
            isOfficialSet: true,
            imageId: proposal.imageAssetId,
          },
        })
        createdBuildId = build.id
      }

      await tx.catalogProposal.update({
        where: { id },
        data: { status: 'APPROVED', reviewNote, reviewedById: gate.actorId, reviewedAt: new Date() },
      })
      await tx.auditLog.create({
        data: {
          actorId: gate.actorId,
          action: 'catalog_proposal.approve',
          targetType: proposal.kind === 'PART' ? 'part' : 'build',
          targetId: createdPartId ?? createdBuildId!,
          summary:
            proposal.kind === 'PART'
              ? `Katalog-Vorschlag „${(proposal.payload as unknown as InlinePartPayload).name}“ genehmigt — Teil angelegt`
              : `Katalog-Vorschlag „${(proposal.payload as unknown as BuildProposalPayload).name}“ genehmigt — Set angelegt`,
        },
      })
      return { createdPartId, createdBuildId }
    })

    await notifyUser(proposal.submittedById, {
      title: 'Katalog-Vorschlag genehmigt',
      message:
        proposal.kind === 'PART'
          ? `„${(proposal.payload as unknown as InlinePartPayload).name}“ ist jetzt im Katalog.`
          : `Das Set „${(proposal.payload as unknown as BuildProposalPayload).name}“ ist jetzt im Katalog.`,
      link: result.createdBuildId ? `/builds/${result.createdBuildId}` : '/search',
    })
    return Response.json({ id, status, ...result }, { status: 200 })
  } catch (err) {
    if (err instanceof ComboExistsError) {
      return Response.json({ error: 'combo_exists', id: err.buildId, existing: true }, { status: 409 })
    }
    if (err instanceof Error && err.message.startsWith('invalid_slot_')) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
