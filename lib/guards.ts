// lib/guards.ts (RC4, issue #48)
// Central auth guards — the ONE place session-gating and role-gating live, replacing the
// previously 112× duplicated `const session = await auth(); if (!session?.user?.id) return
// Response.json({ error: 'unauthorized' }, { status: 401 })` prologue in every route handler.
//
// Why a lib/ helper and NOT Next 16 proxy/middleware (decided in issue #48):
//   - Next 16 renamed middleware to `proxy.ts`; it runs before routing and cannot see route
//     params or resource state, so every fine-grained check (Admin vs. Curator vs. assigned
//     Judge vs. resource Owner, guest-allowed routes) would STILL need per-route code — the
//     proxy would only ever cover the coarse "has a session" tier and duplicate the JWT
//     verification path instead of reusing `auth()` from lib/auth.ts.
//   - Guards reuse `auth()` directly: no duplicated JWT logic, no matcher drift, no risk of
//     silently un-protecting a route when it moves (a proxy matcher is a build-time constant
//     that a file move can orphan; a guard is a call-site that fails typecheck if removed).
//
// Contract: every guard returns EITHER `{ error: Response }` (a finished 401/403 the route
// returns verbatim) OR `{ userId, ... }` — routes branch with `if ('error' in gate) return
// gate.error`. The `{ error } | { userId }` discriminated union matches the idiom the admin
// routes already used, so migrations are mechanical.
//
// TIER SEMANTICS (preserved from the pre-guard routes, do not widen silently):
//   - requireUser    — any authenticated account (GUEST and up).
//   - requireCurator — the widened Phase 11 reviewer tier TRUSTED/JUDGE/ORGANIZER/ADMIN
//                      (lib/roles.ts CURATOR_ROLES) — proposal review + parts curation.
//   - requireAdmin   — ADMIN only (season boundaries, role assignment).
//   Resource-scoped tiers (assigned Judge, resource Owner, ACTIVE club admin) are NOT roles:
//   they stay in the route, layered on top of requireUser/requireAdmin, e.g.
//     const gate = await requireUser(); if ('error' in gate) return gate.error
//     ... if (resource.ownerId !== gate.userId && !(await isAdminUser(gate.userId))) 403
//
// MIGRATION PLAN (rest of the ~92 files, follow-up tickets): migrate route-by-route in the
// same mechanical steps used here: (1) replace the auth() prologue with the guard, (2) let the
// guard's userId flow into the existing code, (3) delete the local 401 response. Start with
// write-routes (mutation risk), then read-routes; pages/layouts keep their own auth() calls
// because they need the full session object, not just a gate. Never "clean up" a route's
// resource-scoped check into a role check while migrating — that is exactly the drift these
// guards exist to prevent (see issue #42).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isCurator, type CuratorRole } from '@/lib/roles'
import type { Role } from '@prisma/client'

export type GuardError = { error: Response }
export type UserGate = GuardError | { userId: string }
export type RoleGate = GuardError | { userId: string; role: Role }

function unauthorized(): GuardError {
  return { error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
}

function forbidden(): GuardError {
  return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
}

/** Any authenticated account. Returns the caller's userId or a finished 401. */
export async function requireUser(): Promise<UserGate> {
  const session = await auth()
  if (!session?.user?.id) return unauthorized()
  return { userId: session.user.id }
}

/** Reads the caller's live Role — for RESOURCE-SCOPED checks that combine a role with
 *  ownership/assignment (assigned Judge, tournament Owner, …). Prefer requireRole and friends
 *  for plain role gates so the role list stays canonical. */
export async function getCallerRole(userId: string): Promise<Role | null> {
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return caller?.role ?? null
}

/** One of the given roles (e.g. requireRole('ORGANIZER', 'ADMIN')), or 401/403. */
export async function requireRole(...roles: readonly Role[]): Promise<RoleGate> {
  const gate = await requireUser()
  if ('error' in gate) return gate
  const role = await getCallerRole(gate.userId)
  if (!role || !roles.includes(role)) return forbidden()
  return { userId: gate.userId, role }
}

/** The widened Phase 11 reviewer tier (TRUSTED/JUDGE/ORGANIZER/ADMIN via lib/roles.ts). */
export async function requireCurator(): Promise<RoleGate> {
  const gate = await requireUser()
  if ('error' in gate) return gate
  const role = await getCallerRole(gate.userId)
  if (!isCurator(role)) return forbidden()
  return { userId: gate.userId, role: role as CuratorRole }
}

/** ADMIN only — the narrowest tier (season boundaries, role assignment). */
export async function requireAdmin(): Promise<RoleGate> {
  return requireRole('ADMIN')
}
