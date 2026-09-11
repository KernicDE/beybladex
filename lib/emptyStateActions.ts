// lib/emptyStateActions.ts (RC10 #28)
// Pure decision logic for list-view EmptyState CTAs, kept out of the server pages so it
// is unit-testable without a database: given WHO is looking (role/session) and WHAT is
// empty (whole catalog vs. an active filter), which concrete next step do we offer?
// Admin CTAs point at the admin surface that fixes the emptiness; visitor CTAs point at
// a working public area — never at the empty page itself.
// RC14-Nachzügler #130 — the CTA LABELS are injectable (dictionary strings from the calling
// page); the href decisions stay here. German defaults keep not-yet-translated call sites
// working.
export interface EmptyStateAction {
  href: string
  label: string
}

import type { Role } from '@prisma/client'

export type ViewerRole = Role | null

/** CTA labels for the catalog/rangliste empty states (t.builds and t.leaderboard strings). */
export interface CatalogActionLabels {
  addParts: string
  discoverEvents: string
}

const DE_CATALOG_LABELS: CatalogActionLabels = {
  addParts: 'Teile hinzufügen',
  discoverEvents: 'Kommende Events entdecken',
}

export interface RanglisteActionLabels {
  /** Carries a {name} slot for the season name. */
  lastSeason: string
  notifyInbox: string
  notifyLogin: string
}

const DE_RANGLISTE_LABELS: RanglisteActionLabels = {
  lastSeason: 'Letzte Season ansehen: {name}',
  notifyInbox: 'Bei Season-Start benachrichtigen',
  notifyLogin: 'Anmelden, um benachrichtigt zu werden',
}

// Builds catalog (/builds) or Meta overview with NO active filter: the catalog itself is
// empty — only admins can change that (parts are created in the parts admin), everyone
// else gets a living public surface.
export function catalogEmptyAction(role: ViewerRole, labels: CatalogActionLabels = DE_CATALOG_LABELS): EmptyStateAction {
  return role === 'ADMIN'
    ? { href: '/settings/admin/parts', label: labels.addParts }
    : { href: '/events', label: labels.discoverEvents }
}

// Meta (/meta): a filter-induced emptiness is fixable by the visitor themselves —
// resetting beats redirecting.
export function metaEmptyAction(
  opts: { kind: 'builds' | 'parts'; filtered: boolean; role: ViewerRole; labels?: CatalogActionLabels },
): EmptyStateAction {
  if (opts.filtered) return { href: '/meta', label: 'Filter zurücksetzen' }
  return catalogEmptyAction(opts.role, opts.labels)
}

// Rangliste: no ACTIVE season. The primary offramp is the most recent COMPLETED season
// (if any); the secondary CTA routes into the notification inbox, where season/tournament
// announcements land for logged-in users — guests get the login path instead.
export function ranglisteEmptyActions(
  opts: { lastSeason: { id: string; name: string } | null; loggedIn: boolean },
  labels: RanglisteActionLabels = DE_RANGLISTE_LABELS,
): EmptyStateAction[] {
  const actions: EmptyStateAction[] = []
  if (opts.lastSeason) {
    actions.push({
      href: `/rangliste?season=${encodeURIComponent(opts.lastSeason.id)}`,
      label: labels.lastSeason.replace('{name}', opts.lastSeason.name),
    })
  }
  actions.push(
    opts.loggedIn
      ? { href: '/notifications', label: labels.notifyInbox }
      : { href: '/login', label: labels.notifyLogin },
  )
  return actions
}
