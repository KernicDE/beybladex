// tests/unit/guest-gate.test.tsx (RC8 issue #20)
// /decks and /collection used to silently redirect('/login') for guests. They now render
// an explained GuestGate: what the feature is, why login is required, and CTAs — the
// login CTA must carry the callbackUrl so the user returns after signing in.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GuestGate } from '@/components/auth/GuestGate'

describe('GuestGate', () => {
  it('explains the gate and links login with the callbackUrl', () => {
    render(
      <GuestGate
        title="Decks sind nur für Mitglieder"
        description="Melde dich an, um deine Decks zu erstellen."
        callbackUrl="/decks"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Decks sind nur für Mitglieder' })).toBeInTheDocument()
    expect(screen.getByText('Melde dich an, um deine Decks zu erstellen.')).toBeInTheDocument()

    const login = screen.getByRole('link', { name: 'Anmelden' })
    expect(login).toHaveAttribute('href', '/login?callbackUrl=%2Fdecks')
    expect(screen.getByRole('link', { name: 'Registrieren' })).toHaveAttribute('href', '/register')

    expect(screen.getByText(/automatisch zu dieser Seite zurückgeleitet/i)).toBeInTheDocument()
  })
})
