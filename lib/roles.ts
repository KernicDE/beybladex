// lib/roles.ts (Phase 11)
// Shared role-tier helpers. The Phase 11 reviewer/curator tier was explicitly widened past
// PartRequest's original TRUSTED/ADMIN pair to TRUSTED/JUDGE/ORGANIZER/ADMIN — those are the
// people most likely to encounter an uncatalogued real-world part at an event.
export const CURATOR_ROLES = ['TRUSTED', 'JUDGE', 'ORGANIZER', 'ADMIN'] as const

export function isCurator(role: string | null | undefined): role is (typeof CURATOR_ROLES)[number] {
  return role != null && (CURATOR_ROLES as readonly string[]).includes(role)
}
