// tests/unit/mobile-nav-more-menu.test.tsx (RC8 issue #24)
// Guests on mobile had no path to /rules and /rangliste — the five bottom tabs covered
// only Start/Events/Decks/Sammlung/Profil. The nav now spends its fifth slot on a
// "Mehr" menu (Start was folded into it; the sticky Header brand link remains the
// 1-tap home path) holding the remaining public surfaces. Regression test: the menu
// holds /rules and /rangliste (plus Startseite), renders for guests AND signed-in
// users, and the four tab links keep working.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { Session } from 'next-auth'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

import { MobileNav } from '@/components/layout/MobileNav'

const session = { user: { name: 'tester' }, expires: '2099-01-01' } as unknown as Session

describe('MobileNav — Mehr menu (issue #24)', () => {
  it.each([
    ['guests', null],
    ['signed-in users', session],
  ])('gives %s a path to Regeln and Rangliste', (_label, sess) => {
    render(<MobileNav session={sess} />)

    fireEvent.click(screen.getByRole('button', { name: /mehr/i }))

    expect(screen.getByRole('menuitem', { name: 'Regeln' })).toHaveAttribute('href', '/rules')
    expect(screen.getByRole('menuitem', { name: 'Rangliste' })).toHaveAttribute('href', '/rangliste')
    expect(screen.getByRole('menuitem', { name: 'Startseite' })).toHaveAttribute('href', '/')
  })

  it('keeps the four tab links working', () => {
    render(<MobileNav session={session} />)

    expect(screen.getByRole('link', { name: /events/i })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('link', { name: /decks/i })).toHaveAttribute('href', '/decks')
    expect(screen.getByRole('link', { name: /sammlung/i })).toHaveAttribute('href', '/collection')
    expect(screen.getByRole('link', { name: /profil/i })).toHaveAttribute('href', '/profile/tester')
  })

  it('points the Profil tab at /login for guests', () => {
    render(<MobileNav session={null} />)

    expect(screen.getByRole('link', { name: /profil/i })).toHaveAttribute('href', '/login')
  })

  it('closes the menu on Escape', () => {
    render(<MobileNav session={null} />)

    fireEvent.click(screen.getByRole('button', { name: /mehr/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
