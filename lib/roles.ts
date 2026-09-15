// lib/roles.ts (Phase 11; Issue #199 follow-up — Judge and Organizer made additive)
// Shared role-tier helpers. The trust ladder is GUEST < USER < TRUSTED < ADMIN. Judge and
// Organizer are NOT trust-tier roles — they're independent capabilities (User.isJudge /
// User.isOrganizer) combinable with any tier. The Phase 11 reviewer/curator tier is
// TRUSTED/ADMIN plus anyone with isJudge or isOrganizer set — those are the people most likely
// to encounter an uncatalogued real-world part at an event.
export const CURATOR_ROLES = ['TRUSTED', 'ADMIN'] as const

export type CuratorRole = (typeof CURATOR_ROLES)[number]

type CuratorCheckInput = { role?: string | null; isJudge?: boolean | null; isOrganizer?: boolean | null }

export function isCurator(user: CuratorCheckInput | string | null | undefined): boolean {
  const u: CuratorCheckInput = typeof user === 'string' || user == null ? { role: user } : user
  return (u.role != null && (CURATOR_ROLES as readonly string[]).includes(u.role)) || u.isJudge === true || u.isOrganizer === true
}
