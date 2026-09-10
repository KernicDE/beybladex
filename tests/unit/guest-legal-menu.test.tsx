// tests/unit/guest-legal-menu.test.tsx
// Regression test for issue #22: a guest (no session) had no path — on any viewport —
// to Impressum/Datenschutz/AGB, since the Footer carrying those links is desktop-only
// (`md:block`) and UserMenu (the mobile path for logged-in users) only renders for a
// session. The Header now renders GuestLegalMenu whenever there is no session, giving
// guests a ≤2-click path (open menu, click link) that isn't gated behind a breakpoint.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Header } from '@/components/layout/Header'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

describe('Header — guest legal links (issue #22)', () => {
  it('gives a guest a path to Impressum, Datenschutz and AGB', () => {
    render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /rechtliches/i }))

    expect(screen.getByRole('menuitem', { name: 'Impressum' })).toHaveAttribute('href', '/impressum')
    expect(screen.getByRole('menuitem', { name: 'Datenschutz' })).toHaveAttribute('href', '/datenschutz')
    expect(screen.getByRole('menuitem', { name: 'AGB' })).toHaveAttribute('href', '/agb')
  })

  it('does not render the guest legal menu once a session exists (UserMenu carries the links instead)', () => {
    render(
      <ThemeProvider>
        <Header
          session={{ user: { name: 'tester' }, expires: '2099-01-01' } as never}
          avatarImageId={null}
        />
      </ThemeProvider>
    )

    expect(screen.queryByRole('button', { name: /rechtliches/i })).not.toBeInTheDocument()
  })
})
