// lib/assembly.ts (MVP4, #139/#141) — Assembly-Shared-Lib für Beyblade UND Build.
// Das Drei-Entitäten-Modell trennt offizielle Sets (Beyblade) von persönlichen Kombinationen
// (Build), aber BEIDE tragen dieselbe 7-Slot-Teileassembly. Diese Datei ist die EINE Stelle
// für Slot-Struktur und Validierungsregeln — doppelte Drift-Stellen gibt es nicht:
//   • Slot-Modell (RC16 #122): Blade-Assembly als EIN BLADE-Teil ODER kompletter Vierer-CX-
//     Stack (lockChip + overBlade + metalBlade + assistBlade); bitId in jeder Bauform Pflicht;
//     ratchetId Pflicht, außer das Blade-Teil integriert das Ratchet (dann verboten).
//   • comboWhere: NULL-sicherer Dedup-Key über alle 7 Slots (Prisma-where/create-Objekt;
//     der DB-Backstop ist je ein handschriftlicher COALESCE-Unique-Index pro Tabelle,
//     "Build_combo_key" / "Beyblade_combo_key" — beide Kombinationen dürfen BEWUSST parallel
//     existieren: "Build von einer Beyblade erstellen" übernimmt dieselben Teile).
//   • deriveAssemblyTraits: Beyblade/Build haben KEINE type/spinDirection-Spalten mehr —
//     beides wird aus dem Blade-Teil abgeleitet (kein Drift zwischen gepflegtem Wert und
//     Teile-Katalog).
import type { BeyType, SpinDirection } from '@prisma/client'

// Which catalog category each assembly slot demands — the route verifies the referenced Part
// actually belongs to the slot (never trusting the client's slot label).
export const SLOT_CATEGORY = {
  bladeId: 'BLADE',
  lockChipId: 'LOCK_CHIP',
  overBladeId: 'OVER_BLADE',
  metalBladeId: 'METAL_BLADE',
  assistBladeId: 'ASSIST_BLADE',
  ratchetId: 'RATCHET',
  bitId: 'BIT',
} as const
export const ASSEMBLY_SLOTS = ['bladeId', 'lockChipId', 'overBladeId', 'metalBladeId', 'assistBladeId', 'ratchetId', 'bitId'] as const
// RC16 (#122) — Custom Line: die vier Blade-Stack-Slots, immer komplett oder gar nicht.
export const CUSTOM_LINE_SLOTS = ['lockChipId', 'overBladeId', 'metalBladeId', 'assistBladeId'] as const

export type AssemblySlot = (typeof ASSEMBLY_SLOTS)[number]

/** Die 7 Assembly-Slots mit Id-Feldern — die gemeinsame Struktur von Build und Beyblade. */
export interface AssemblyInput {
  bladeId: string | null
  lockChipId: string | null
  overBladeId: string | null
  metalBladeId: string | null
  assistBladeId: string | null
  ratchetId: string | null
  bitId: string
}

// Relation names without the "Id" suffix — für OR-Filter über alle 7 Slot-FKs (Teil-Detail-
// Verweise, Suche) und die Verfügbarkeitslogik ("besitzt alle Teile"). Build und Beyblade
// nutzen dieselben Feldnamen, ein Filter passt also auf beide Modelle.
export const ASSEMBLY_PART_SLOTS = ['blade', 'lockChip', 'overBlade', 'metalBlade', 'assistBlade', 'ratchet', 'bit'] as const

/** Structural blade-assembly rule (DB-free, so parse-time): genau EINE Blade-Form —
 *  einzelnes BLADE-Teil ODER kompletter Vierer-CX-Stack; ein Teil-Stack wird abgelehnt. */
export function bladeAssemblyErrors(input: AssemblyInput): string[] {
  const cxPresent = CUSTOM_LINE_SLOTS.filter((s) => input[s] !== null).length
  if (input.bladeId !== null && cxPresent > 0) return ['invalid_bladeId']
  if (input.bladeId === null && cxPresent !== CUSTOM_LINE_SLOTS.length) {
    // Weder Blade noch vollständiger CX-Stack — fehlende CX-Slots benennen, sonst reicht invalid_bladeId.
    if (cxPresent > 0) return CUSTOM_LINE_SLOTS.filter((s) => input[s] === null).map((s) => `invalid_${s}`)
    return ['invalid_bladeId']
  }
  return []
}

/** The full 7-slot combo of an assembly input, nulls preserved (null = "kein Teil in diesem Slot").
 *  Usable as a Prisma where/create object for Build AND Beyblade (identical column names):
 *  Prisma translates a null field to IS NULL, so findFirst with this object matches the exact
 *  combo even for 2-slot (ratchet-integrated) and 6-slot (Custom Line) assemblies. */
export function comboWhere(input: Pick<AssemblyInput, AssemblySlot>) {
  return {
    bladeId: input.bladeId,
    lockChipId: input.lockChipId,
    overBladeId: input.overBladeId,
    metalBladeId: input.metalBladeId,
    assistBladeId: input.assistBladeId,
    ratchetId: input.ratchetId,
    bitId: input.bitId,
  }
}

/** Verifies that the referenced parts exist AND sit in the slot's category, plus the RC16
 *  (#122) blade-assembly and ratchet rules. Returns the verified parts (id → part) or an
 *  error token. The name/manufacturer are included so creation call sites can derive the
 *  canonical name (Phase 20) resp. the Set-Hersteller (MVP4) ohne zweiten DB-Roundtrip;
 *  isRatchetIntegrated decides the ratchet rule. Works for Build and Beyblade creates alike —
 *  the seam is the minimal Prisma surface both call sites have. */
export async function verifyAssemblyParts(
  prisma: {
    part: {
      findMany(args: {
        where: { id: { in: string[] } }
        select: { id: true; category: true; name: true; manufacturer: true; isRatchetIntegrated: true }
      }): Promise<{ id: string; category: string; name: string; manufacturer: string; isRatchetIntegrated: boolean }[]>
    }
  },
  input: Pick<AssemblyInput, AssemblySlot>,
): Promise<{ error: string } | { parts: Map<string, { id: string; category: string; name: string; manufacturer: string; isRatchetIntegrated: boolean }> }> {
  const ids = ASSEMBLY_SLOTS.map((s) => input[s]).filter((id): id is string => id !== null)
  const found = await prisma.part.findMany({ where: { id: { in: ids } }, select: { id: true, category: true, name: true, manufacturer: true, isRatchetIntegrated: true } })
  const byId = new Map(found.map((p) => [p.id, p]))
  for (const slot of ASSEMBLY_SLOTS) {
    const id = input[slot]
    if (id === null) continue // RC16 — leere Slots (CX-Blade, integriertes Ratchet) sind legal
    const part = byId.get(id)
    if (!part) return { error: `unknown_${slot}` }
    if (part.category !== SLOT_CATEGORY[slot]) return { error: `invalid_${slot}` }
  }
  // Ratchet-Regel: Pflicht außer das Blade-Teil integriert das Ratchet — dann verboten.
  // (Für CX-Assembly ist input.bladeId null → isRatchetIntegrated undefined → Ratchet Pflicht.)
  const bladePart = input.bladeId !== null ? byId.get(input.bladeId) : undefined
  if (bladePart?.isRatchetIntegrated) {
    if (input.ratchetId !== null) return { error: 'ratchet_not_allowed' }
  } else if (input.ratchetId === null) {
    return { error: 'ratchet_required' }
  }
  return { parts: byId }
}

/** Teil-Detail-Verweise (MVP4/1, Aufgabe 7): Prisma-where-Objekt "alle Beyblades/Builds, die
 *  dieses Teil in irgendeinem Slot enthalten" — OR über alle 7 Slot-FKs. Wird von der
 *  Teil-Detailseite (/parts/[id]) für BEIDE Aggregate genutzt. */
export function partOccurrenceWhere(partId: string) {
  return { OR: ASSEMBLY_PART_SLOTS.map((slot) => ({ [`${slot}Id`]: partId })) }
}

/** Abgeleitete Traits einer Assembly (MVP4): Beyblade/Build speichern type/spinDirection
 *  NICHT als Spalten — beides kommt aus dem Blade-Teil (BLADE-Teil bei Standard/Ratchet-
 *  Integrated, Lock Chip bei Custom Line). null nur, wenn gar keine Blade-Assembly vorliegt
 *  (für verifizierte Assemblys nie der Fall — bitId ist Pflicht, Blade-Assembly exakt eine). */
export function deriveAssemblyTraits(
  blade: { beyType: BeyType | null; spinDirection: SpinDirection } | null,
  lockChip: { beyType: BeyType | null; spinDirection: SpinDirection } | null,
): { beyType: BeyType | null; spinDirection: SpinDirection } | null {
  const head = blade ?? lockChip
  return head ? { beyType: head.beyType, spinDirection: head.spinDirection } : null
}
