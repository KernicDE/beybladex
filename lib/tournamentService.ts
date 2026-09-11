// lib/tournamentService.ts (RC6, issue #70 — service layer for the tournament aggregate)
// The tournament routes used to hand-roll the same organizer-authz precondition in 9+ handlers:
//   const tournament = await prisma.tournament.findUnique(...)
//   if (!tournament) return 404
//   const caller = await prisma.user.findUnique(... role ...)
//   if (tournament.createdById !== userId && caller?.role !== 'ADMIN') return 403
// One subtle divergence had already crept in (a `Response | undefined` union in judges/route.ts,
// worked around with runtime `if (authz) return authz` because TS couldn't narrow it). This
// module is the single home for that contract — a discriminated union that narrows cleanly:
//
//   const { error, tournament } = await authorizeTournamentOrganizer(id, userId, { ...select })
//   if (error) return error
//   // tournament is fully typed here, non-null
//
// SCOPE (deliberately not a Big-Bang refactor): mutations with the organizer/ADMIN authz tier
// migrate here route by route. PUBLIC read surfaces keep their own loaders — they have different
// performance contracts (loadTournamentBracket's one-query include, lib/publicCache.ts's Redis
// TTL for the public detail page) that a generic service loader would only blur. Ownership vs
// visibility: tournaments are publicly READABLE (public detail + bracket pages), so the service
// encodes OWNERSHIP (who may mutate), not visibility gating.
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

/** createdById must always be selected — the ownership check reads it. */
type OrganizerSelect = Prisma.TournamentSelect & { createdById: true }

export type OrganizerAuthz<T extends OrganizerSelect> =
  | { error: Response; tournament: undefined }
  | { error: null; tournament: Prisma.TournamentGetPayload<{ select: T }> }

/**
 * Load a tournament and verify the caller may ORGANIZE it (createdById or ADMIN role).
 * 404 when the tournament does not exist, 403 for everyone else — the exact contract every
 * migrated route previously expressed inline. `select` keeps each route's query minimal
 * (Prisma select-args typing, same as the old per-route findUnique calls).
 */
export async function authorizeTournamentOrganizer<T extends OrganizerSelect>(
  tournamentId: string,
  userId: string,
  select: T
): Promise<OrganizerAuthz<T>> {
  // T already guarantees createdById: true (OrganizerSelect), so the plain select works; the
  // intersection types the check target explicitly — Prisma's generic findUnique payload
  // doesn't surface select-key guarantees.
  const tournament = (await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select,
  })) as (Prisma.TournamentGetPayload<{ select: T }> & { createdById: string }) | null
  if (!tournament) {
    return { error: Response.json({ error: 'not_found' }, { status: 404 }), tournament: undefined }
  }
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (tournament.createdById !== userId && caller?.role !== 'ADMIN') {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }), tournament: undefined }
  }
  return { error: null, tournament }
}
