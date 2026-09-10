// lib/deckValidation.ts (Phase 5 Part A; Phase 16 adds format-aware validation)
// Deck rule validator: a deck may not contain two builds that share ANY part (blade, ratchet
// or bit) — the WBO-counterdeck / 3on3 rule. Enforced BOTH client-side (DeckBuilder instant
// feedback via validateNoDuplicateParts) and server-side in app/api/decks/route.ts; the
// DeckBuild @@unique([deckId, buildId]) backstop covers the "same build twice" case at the DB.
//
// Phase 16 item 4: `validateNoDuplicateParts` itself is UNCHANGED (decks aren't tied to a
// Ruleset at creation time — a deck is a personal, reusable object that may later be registered
// for tournaments of different formats — so deck creation keeps today's format-agnostic shape).
// The NEW `validateDeckForFormat` below is what's actually format-aware, used where a format IS
// known: at tournament join/deck-edit time (app/api/tournaments/[id]/join/route.ts), against
// the tournament's linked Ruleset.deckFormat.
import type { Build, DeckFormat } from '@prisma/client'

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

/** How many builds a Deck must have to be valid for the given tournament DeckFormat. */
export function requiredBuildCountForFormat(format: DeckFormat): number {
  // ONE_ON_ONE fields a single build per match, so exactly one is registered. Every other
  // format currently implemented (WBO_COUNTERDECK, THREE_ON_THREE, PICK_THREE_CHOOSE_ONE)
  // registers a deck of three builds — PICK_THREE_CHOOSE_ONE picks ONE of the three per match,
  // but still registers all three at deck-build time, same as the others.
  return format === 'ONE_ON_ONE' ? 1 : 3
}

/**
 * Format-aware deck validation for a known tournament context (Phase 16 item 4/5) — build
 * count AND, for most formats, the no-duplicate-parts rule.
 *
 * OPEN QUESTION, deliberately unresolved (master plan Phase 16 item 4): whether
 * PICK_THREE_CHOOSE_ONE's three registered builds may share parts (only one is fielded per
 * match, so the WBO-counterdeck logic for why sharing matters may not apply the same way) has
 * NOT been confirmed with the user against the real WBO/BLG ruleset text — do not silently
 * invent that rule. Until confirmed, PICK_THREE_CHOOSE_ONE build count is still enforced (3),
 * but the duplicate-parts check is SKIPPED for it (the permissive default — easy to tighten
 * later without a breaking behavior change, unlike wrongly rejecting a legal deck today).
 */
export function validateDeckForFormat(builds: SlotSource[], format: DeckFormat): DeckValidationResult {
  const conflicts: string[] = []
  const required = requiredBuildCountForFormat(format)
  if (builds.length !== required) {
    conflicts.push(`Dieses Regelwerk benötigt genau ${required} Build${required === 1 ? '' : 's'} im Deck (aktuell ${builds.length}).`)
  }
  if (format !== 'PICK_THREE_CHOOSE_ONE') {
    conflicts.push(...validateNoDuplicateParts(builds).conflicts)
  }
  return { valid: conflicts.length === 0, conflicts }
}
