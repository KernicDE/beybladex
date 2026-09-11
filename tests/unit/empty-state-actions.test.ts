// tests/unit/empty-state-actions.test.ts (RC10 #28)
// The list-view EmptyStates (Builds, Meta, Rangliste) must offer a concrete next step,
// role-dependent where it matters: admins get the surface that FIXES the emptiness,
// visitors get a living public area; the rangliste dead-end additionally offers the last
// completed season and a notification offramp.
import { describe, it, expect } from 'vitest'
import { catalogEmptyAction, metaEmptyAction, ranglisteEmptyActions } from '@/lib/emptyStateActions'

describe('catalogEmptyAction (Builds / Meta ohne Filter)', () => {
  it('points admins at the parts admin (they can fix the emptiness)', () => {
    expect(catalogEmptyAction('ADMIN')).toEqual({ href: '/settings/admin/parts', label: 'Teile hinzufügen' })
  })

  it.each([
    ['regular users', 'USER' as const],
    ['guests', null],
  ])('points %s at a living public surface', (_label, role) => {
    expect(catalogEmptyAction(role)).toEqual({ href: '/events', label: 'Kommende Events entdecken' })
  })
})

describe('metaEmptyAction (Meta builds/parts)', () => {
  it('offers to reset the filter when the emptiness is filter-induced', () => {
    expect(metaEmptyAction({ kind: 'parts', filtered: true, role: 'ADMIN' })).toEqual({
      href: '/meta',
      label: 'Filter zurücksetzen',
    })
    expect(metaEmptyAction({ kind: 'builds', filtered: true, role: null })).toEqual({
      href: '/meta',
      label: 'Filter zurücksetzen',
    })
  })

  it('falls back to the catalog CTA when nothing is filtered', () => {
    expect(metaEmptyAction({ kind: 'builds', filtered: false, role: 'ADMIN' }).href).toBe('/settings/admin/parts')
    expect(metaEmptyAction({ kind: 'parts', filtered: false, role: null }).href).toBe('/events')
  })
})

describe('ranglisteEmptyActions (keine aktive Season)', () => {
  it('links the last completed season when one exists', () => {
    const actions = ranglisteEmptyActions({ lastSeason: { id: 's1', name: 'Season 1' }, loggedIn: true })
    expect(actions[0]).toEqual({ href: '/rangliste?season=s1', label: 'Letzte Season ansehen: Season 1' })
  })

  it('omits the season link when no completed season exists', () => {
    const actions = ranglisteEmptyActions({ lastSeason: null, loggedIn: true })
    expect(actions).toHaveLength(1)
    expect(actions[0].href).toBe('/notifications')
  })

  it('routes the notification offramp through login for guests', () => {
    const actions = ranglisteEmptyActions({ lastSeason: null, loggedIn: false })
    expect(actions[0]).toEqual({ href: '/login', label: 'Anmelden, um benachrichtigt zu werden' })
  })

  it('keeps the season link first and the offramp second when both exist', () => {
    const actions = ranglisteEmptyActions({ lastSeason: { id: 's9', name: 'Herbst 2026' }, loggedIn: false })
    expect(actions.map((a) => a.href)).toEqual(['/rangliste?season=s9', '/login'])
  })

  // RC14-Nachzügler #130 — the pages inject their dictionary strings; href decisions stay here.
  it('renders injected (translated) labels instead of the German defaults', () => {
    const en = {
      lastSeason: 'View last season: {name}',
      notifyInbox: 'Get notified when a season starts',
      notifyLogin: 'Sign in to get notified',
    }
    const actions = ranglisteEmptyActions({ lastSeason: { id: 's1', name: 'Fall 2026' }, loggedIn: false }, en)
    expect(actions[0]).toEqual({ href: '/rangliste?season=s1', label: 'View last season: Fall 2026' })
    expect(actions[1]).toEqual({ href: '/login', label: 'Sign in to get notified' })

    expect(catalogEmptyAction('ADMIN', { addParts: 'Add parts', discoverEvents: 'Discover upcoming events' }))
      .toEqual({ href: '/settings/admin/parts', label: 'Add parts' })
  })
})
