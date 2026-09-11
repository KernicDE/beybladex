// lib/emptyStateActions.ts (RC10 #28)
// Pure decision logic for list-view EmptyState CTAs, kept out of the server pages so it
// is unit-testable without a database: given WHO is looking (role/session) and WHAT is
// empty (whole catalog vs. an active filter), which concrete next step do we offer?
// Admin CTAs point at the admin surface that fixes the emptiness; visitor CTAs point at
// a working public area — never at the empty page itself.
export interface EmptyStateAction {
  href: string
  label: string
}

import type { Role } from '@prisma/client'

export type ViewerRole = Role | null

// Builds catalog (/builds) or Meta overview with NO active filter: the catalog itself is
// empty — only admins can change that (parts are created in the parts admin), everyone
// else gets a living public surface.
export function catalogEmptyAction(role: ViewerRole): EmptyStateAction {
  return role === 'ADMIN'
    ? { href: '/settings/admin/parts', label: 'Teile hinzufügen' }
    : { href: '/events', label: 'Kommende Events entdecken' }
}

// Meta (/meta): a filter-induced emptiness is fixable by the visitor themselves —
// resetting beats redirecting.
export function metaEmptyAction(opts: { kind: 'builds' | 'parts'; filtered: boolean; role: ViewerRole }): EmptyStateAction {
  if (opts.filtered) return { href: '/meta', label: 'Filter zurücksetzen' }
  return catalogEmptyAction(opts.role)
}

// Rangliste: no ACTIVE season. The primary offramp is the most recent COMPLETED season
// (if any); the secondary CTA routes into the notification inbox, where season/tournament
// announcements land for logged-in users — guests get the login path instead.
export function ranglisteEmptyActions(opts: {
  lastSeason: { id: string; name: string } | null
  loggedIn: boolean
}): EmptyStateAction[] {
  const actions: EmptyStateAction[] = []
  if (opts.lastSeason) {
    actions.push({
      href: `/rangliste?season=${encodeURIComponent(opts.lastSeason.id)}`,
      label: `Letzte Season ansehen: ${opts.lastSeason.name}`,
    })
  }
  actions.push(
    opts.loggedIn
      ? { href: '/notifications', label: 'Bei Season-Start benachrichtigen' }
      : { href: '/login', label: 'Anmelden, um benachrichtigt zu werden' },
  )
  return actions
}
