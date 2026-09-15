// tests/unit/guest-tab-banner.test.tsx (issue #197)
// GuestTabBanner is GuestGate's compact sibling for embedding inside one tab panel while the
// page's other tabs (public builds, catalog) stay open to guests.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GuestTabBanner } from '@/components/auth/GuestTabBanner'

describe('GuestTabBanner', () => {
  it('explains the gate and links login with the callbackUrl', () => {
    render(
      <GuestTabBanner
        title="Builds sind nur für Mitglieder"
        description="Melde dich an, um deine Builds zu sehen."
        callbackUrl="/builds?tab=mine"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Builds sind nur für Mitglieder' })).toBeInTheDocument()
    expect(screen.getByText('Melde dich an, um deine Builds zu sehen.')).toBeInTheDocument()

    const login = screen.getByRole('link', { name: 'Anmelden' })
    expect(login).toHaveAttribute('href', '/login?callbackUrl=%2Fbuilds%3Ftab%3Dmine')
    expect(screen.getByRole('link', { name: 'Registrieren' })).toHaveAttribute('href', '/register')
  })

  it('renders injected labels when the caller passes them', () => {
    render(
      <GuestTabBanner
        title="Builds are members-only"
        description="Sign in to see your builds."
        callbackUrl="/builds?tab=mine"
        labels={{ signIn: 'Sign in', register: 'Register', footnote: 'unused' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?callbackUrl=%2Fbuilds%3Ftab%3Dmine')
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register')
  })
})
