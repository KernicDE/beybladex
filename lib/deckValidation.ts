// lib/deckValidation.ts (Phase 5 Part A)
// Deck rule validator: a deck may not contain two builds that share ANY part (blade, ratchet
// or bit) — the WBO-counterdeck / 3on3 rule. Enforced BOTH client-side (DeckBuilder instant
// feedback via validateNoDuplicateParts) and server-side in app/api/decks/route.ts; the
// DeckBuild @@unique([deckId, buildId]) backstop covers the "same build twice" case at the DB.
import type { Build } from '@prisma/client'

export type DeckBuildInput = Pick<Build, 'id' | 'bladeId' | 'ratchetId' | 'bitId'>

export interface DeckValidationResult {
  valid: boolean
  /** Human-readable conflict descriptions, e.g. "Blade „DranSword 3-60“ (2×)" */
  conflicts: string[]
}

const SLOTS = [
  { key: 'bladeId', label: 'Blade', nameOf: (b: SlotSource) => b.blade?.name },
  { key: 'ratchetId', label: 'Ratchet', nameOf: (b: SlotSource) => b.ratchet?.name },
  { key: 'bitId', label: 'Bit', nameOf: (b: SlotSource) => b.bit?.name },
] as const

type SlotSource = DeckBuildInput & {
  blade?: { name: string } | null
  ratchet?: { name: string } | null
  bit?: { name: string } | null
}

export function validateNoDuplicateParts(builds: SlotSource[]): DeckValidationResult {
  const conflicts: string[] = []
  for (const { key, label, nameOf } of SLOTS) {
    const byPart = new Map<string, { count: number; name: string }>()
    for (const build of builds) {
      const partId = build[key]
      const entry = byPart.get(partId) ?? { count: 0, name: nameOf(build) ?? 'Unbekanntes Teil' }
      entry.count += 1
      byPart.set(partId, entry)
    }
    for (const { count, name } of byPart.values()) {
      if (count > 1) conflicts.push(`${label} „${name}“ (${count}×)`)
    }
  }
  return { valid: conflicts.length === 0, conflicts }
}
