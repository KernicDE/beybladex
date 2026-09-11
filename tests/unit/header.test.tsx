// tests/unit/header.test.tsx
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('Header', () => {
  it('renders the brand name and a theme toggle', () => {
    render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} />
      </ThemeProvider>
    )
    expect(screen.getByText('BeybladeX.de')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })
})

// RC10 #29: one route, one name. The header's desktop nav and the mobile bottom nav
// must not diverge on the label for the same route ("Turniere & Events" vs "Events"
// was the reported inconsistency) — the public IA term is "Events" (matches /events).
describe('nav label consistency (#29)', () => {
  it('header and MobileNav use the same label for /events', () => {
    const headerView = render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} />
      </ThemeProvider>,
    )
    const headerLink = within(headerView.container).getByRole('link', { name: 'Events' })
    expect(headerLink).toHaveAttribute('href', '/events')

    const mobileView = render(<MobileNav session={null} />)
    const tab = within(mobileView.container).getByRole('link', { name: /events/i })
    expect(tab).toHaveAttribute('href', '/events')
    // Same accessible name (modulo the lock icon slot, unused for /events) — the tab's
    // visible label must equal the header's label, not a longer variant.
    expect(tab.textContent).toBe(headerLink.textContent)
  })
})
