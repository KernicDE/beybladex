// app/api/admin/proposals/route.ts
// Catalog-proposal review (Phase 11, item 1) — replaces PartRequestQueue's settle endpoint.
// PATCH — approve or reject a pending CatalogProposal.
//   AUTHZ RULE (standing Global-Constraints requirement): TRUSTED/JUDGE/ORGANIZER/ADMIN only
//   (the widened reviewer tier — negative test for plain USER in
//   tests/integration/catalog-proposal-flow.test.ts).
//   APPROVE → kind=PART creates the Part row from the validated payload; kind=BUILD creates
//   any inline-new Part rows plus the official Set als BEYBLADE-Zeile (MVP4 #141 — der
//   ProposalKind heißt aus Kompatibilität BUILD, das Aggregat ist kanonisch Beyblade) in ONE
//   transaction — unless the combo (exakte 7-Slot-Teilekombination, RC16 #122) already exists,
//   in which case the transaction answers 409 combo_exists with the EXISTING Beyblade's id
//   (graceful pre-check, never a raw unique-constraint 500). Slot-Kategorien und die Ratchet-
//   Regel verifiziert verifyAssemblyParts aus lib/assembly.ts (DIE Regel-Stelle für Beyblade
//   UND Build — keine doppelte Drift-Stelle). Either kind links the proposal's uploaded
//   MediaAsset (Part.imageId / Beyblade.imageId) and writes an audit row.
//   REJECT → requires a reviewNote (returned to the submitter); sets status + note.
//   Either outcome notifies the submitter via lib/notify.ts's notifyUser.
//   CONCURRENT REVIEWS ([RC2 #53]): the status flip is a CONDITIONAL updateMany
//   (WHERE id AND status='PENDING') inside the settle transaction, modeled on
//   tournaments/[id]/start — two simultaneous approvals can no longer both create a Part/Beyblade
//   row; the loser of the race gets 409 already_reviewed.
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { notifyUser } from '@/lib/notify'
import {
  PROPOSAL_CUSTOM_LINE_SLOTS,
  PROPOSAL_SLOT_CATEGORIES,
  type BuildProposalPayload,
  type InlinePartPayload,
} from '@/lib/proposalValidation'
import type { Manufacturer, PartCategory, BeyType, SpinDirection } from '@prisma/client'
import { comboWhere, verifyAssemblyParts } from '@/lib/assembly'

const STATUSES = ['APPROVED', 'REJECTED'] as const
type SettleStatus = (typeof STATUSES)[number]

// Phase 20 — thrown inside the approval transaction when the proposed combo already backs a
// Beyblade row; the route catches it and answers with the existing Beyblade's id (graceful
// 409 combo_exists) instead of a raw unique-constraint 500 or a second row.
class ComboExistsError extends Error {
  constructor(readonly beybladeId: string) {
    super('combo_exists')
  }
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
  const { allowed } = await rateLimit(`proposals:review:${gate.userId}`, 120, 60 * 60)
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

  if (status === 'REJECTED') {
    // [RC2 #53] Conditional claim, modeled on tournaments/[id]/start: the status flip is an
    // updateMany guarded by status='PENDING' — two concurrent reviewers can no longer both
    // pass the read above and both settle the proposal.
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.catalogProposal.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'REJECTED', reviewNote, reviewedById: gate.userId, reviewedAt: new Date() },
        })
        if (count === 0) throw new Error('ALREADY_REVIEWED_RACE')
        await tx.auditLog.create({
          data: {
            actorId: gate.userId,
            action: 'catalog_proposal.reject',
            targetType: 'catalog_proposal',
            targetId: id,
            summary: `Katalog-Vorschlag ${id} abgelehnt`,
          },
        })
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'ALREADY_REVIEWED_RACE') {
        return Response.json({ error: 'already_reviewed' }, { status: 409 })
      }
      throw e
    }
    await notifyUser(proposal.submittedById, {
      title: 'Katalog-Vorschlag abgelehnt',
      message: `Dein Vorschlag wurde abgelehnt.${reviewNote ? ` Begründung: ${reviewNote}` : ''}`,
      link: '/collection',
    })
    return Response.json({ id, status }, { status: 200 })
  }

  // APPROVE — everything below happens in ONE transaction: the conditional claim (status
  // flip), inline parts + build (or the standalone part), and the audit row. A payload that
  // fails verification mid-transaction rolls the whole approval back.
  // [RC2 #53] The claim is the FIRST statement: an updateMany guarded by status='PENDING'.
  // Two concurrent approvals used to both pass the read above and both create their Part/Beyblade
  // row; now only one transaction can claim the proposal — the loser's count is 0, its
  // transaction throws BEFORE any Part/Build insert, and it gets a clean 409.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.catalogProposal.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewNote, reviewedById: gate.userId, reviewedAt: new Date() },
      })
      if (claimed.count === 0) throw new Error('ALREADY_REVIEWED_RACE')

      let createdPartId: string | null = null
      let createdBeybladeId: string | null = null

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
        const slotPartIds: Partial<Record<keyof typeof PROPOSAL_SLOT_CATEGORIES, string>> = {}
        for (const [slot, category] of Object.entries(PROPOSAL_SLOT_CATEGORIES)) {
          const s = payload.slots[slot as keyof BuildProposalPayload['slots']]
          // RC16 (#122) — CX-Slots sind optional (blade XOR CX-Stack); der Payload-Parser
          // garantiert Vollständigkeit des Stacks, fehlende CX-Slots sind also legal.
          if (!s) {
            if ((PROPOSAL_CUSTOM_LINE_SLOTS as readonly string[]).includes(slot)) continue
            throw new Error(`invalid_slot_${slot}`)
          }
          if (s.partId) {
            // Existenz + Kategorie verifiziert unten zentral via verifyAssemblyParts
            // (lib/assembly.ts) — hier nur die Auflösung partId XOR inline.
            slotPartIds[slot as keyof typeof slotPartIds] = s.partId
          } else if (s.inline) {
            const part = await tx.part.create({ data: { ...inlinePartData(s.inline, category), imageId: null } })
            slotPartIds[slot as keyof typeof slotPartIds] = part.id
          } else {
            throw new Error(`invalid_slot_${slot}`)
          }
        }
        // Slot-Kategorien + Ratchet-Regel (Pflicht außer isRatchetIntegrated-Blade, dann
        // verboten; für CX Pflicht) in der EINEN Regel-Stelle lib/assembly.ts — dieselbe
        // Logik wie beim Build- und Beyblade-Create.
        const input = {
          bladeId: slotPartIds.blade ?? null,
          lockChipId: slotPartIds.lockChip ?? null,
          overBladeId: slotPartIds.overBlade ?? null,
          metalBladeId: slotPartIds.metalBlade ?? null,
          assistBladeId: slotPartIds.assistBlade ?? null,
          ratchetId: slotPartIds.ratchet ?? null,
          bitId: slotPartIds.bit!,
        }
        const verified = await verifyAssemblyParts(tx, input)
        if ('error' in verified) throw new Error(verified.error)
        // Duplicate-combo pre-check (RC16 #122: exakte 7-Slot-Teilekombination, NULL-sicher):
        // dieselben Teile dürfen nicht zwei Beyblade-Zeilen tragen. Der Set-Name ist
        // kuratierte Retail-Daten (vom Payload-Parser required) und bleibt Verbatim.
        const combo = comboWhere(input)
        const existingCombo = await tx.beyblade.findFirst({
          where: combo,
          select: { id: true },
        })
        if (existingCombo) throw new ComboExistsError(existingCombo.id)
        // Hersteller des Sets = Hersteller des Blade-Assembly-Kopfteils (Blade-Teil bzw.
        // Lock Chip bei Custom Line) — aus denselben verified Parts aufgelöst.
        const headPartId = input.bladeId ?? input.lockChipId!
        const beyblade = await tx.beyblade.create({
          data: {
            ...combo,
            name: payload.name,
            manufacturer: (verified.parts.get(headPartId)?.manufacturer ?? 'TT') as Manufacturer,
            imageId: proposal.imageAssetId,
          },
        })
        createdBeybladeId = beyblade.id
      }

      await tx.auditLog.create({
        data: {
          actorId: gate.userId,
          action: 'catalog_proposal.approve',
          targetType: proposal.kind === 'PART' ? 'part' : 'beyblade',
          targetId: createdPartId ?? createdBeybladeId!,
          summary:
            proposal.kind === 'PART'
              ? `Katalog-Vorschlag „${(proposal.payload as unknown as InlinePartPayload).name}“ genehmigt — Teil angelegt`
              : `Katalog-Vorschlag „${(proposal.payload as unknown as BuildProposalPayload).name}“ genehmigt — Set angelegt`,
        },
      })
      return { createdPartId, createdBeybladeId }
    })

    await notifyUser(proposal.submittedById, {
      title: 'Katalog-Vorschlag genehmigt',
      message:
        proposal.kind === 'PART'
          ? `„${(proposal.payload as unknown as InlinePartPayload).name}“ ist jetzt im Katalog.`
          : `Das Set „${(proposal.payload as unknown as BuildProposalPayload).name}“ ist jetzt im Katalog.`,
      // MVP4 #141/#144: genehmigte Sets landen im Beyblades-Tab der Sammlung.
      link: result.createdBeybladeId ? '/collection?tab=beyblades' : '/search',
    })
    return Response.json({ id, status, ...result }, { status: 200 })
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_REVIEWED_RACE') {
      return Response.json({ error: 'already_reviewed' }, { status: 409 })
    }
    if (err instanceof ComboExistsError) {
      return Response.json({ error: 'combo_exists', id: err.beybladeId, existing: true }, { status: 409 })
    }
    // verifyAssemblyParts-Tokens (unknown_<slot> / invalid_<slot> / ratchet_required /
    // ratchet_not_allowed) und die inline-Slot-Auflösung (invalid_slot_<slot>) — alles 400.
    if (
      err instanceof Error &&
      (err.message.startsWith('invalid_') || err.message.startsWith('unknown_') || err.message === 'ratchet_required' || err.message === 'ratchet_not_allowed')
    ) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
