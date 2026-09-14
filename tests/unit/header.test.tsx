// tests/unit/header.test.tsx
// #157 — die Desktop-Hauptnavigation zog aus Header.tsx in Sidebar.tsx (Nutzer-Feedback
// "Verschiebung des Menüs auf die Seite"); Header ist jetzt nur noch die <lg-Utility-Leiste
// (Marke, Suche, Glocke, Sprache, Theme, Nutzermenü) — kein eigener Nav-Link mehr.
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import deMessages from '@/lib/i18n/messages/de.json'

// RC14 #17 — Header/Sidebar/MobileNav render from a request dictionary; the tests pin German
// chrome.
const t = deMessages
const locale = 'de' as const

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('Header (<lg-Utility-Leiste)', () => {
  it('renders the brand name and the theme-toggle trigger (#124, an Sidebar-Header angeglichen in #157)', () => {
    render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} locale={locale} t={t} />
      </ThemeProvider>
    )
    expect(screen.getByText('BeybladeX.de')).toBeInTheDocument()
    // #157 — ein Icon-Trigger statt einer immer sichtbaren 3er-Reihe; Details in
    // tests/unit/theme-toggle.test.tsx.
    expect(screen.getByRole('button', { name: /^Farbschema:/ })).toBeInTheDocument()
  })

  it('trägt keine eigene Seitennavigation mehr (lebt in Sidebar.tsx)', () => {
    render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} locale={locale} t={t} />
      </ThemeProvider>
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

// RC10 #29 (übertragen auf #157): one route, one name. Sidebar (Desktop-Nav seit #157) und
// MobileNav (Bottom-Tabs) dürfen beim Label für dieselbe Route nicht auseinanderlaufen
// ("Turniere & Events" vs "Events" war der ursprünglich gemeldete Fall).
describe('nav label consistency (#29, #157)', () => {
  it('Sidebar und MobileNav verwenden dasselbe Label für /events', () => {
    const sidebarView = render(
      <ThemeProvider>
        <Sidebar session={null} avatarImageId={null} unreadNotifications={0} locale={locale} t={t} />
      </ThemeProvider>,
    )
    const sidebarLink = within(sidebarView.container).getByRole('link', { name: 'Events' })
    expect(sidebarLink).toHaveAttribute('href', '/events')

    const mobileView = render(<MobileNav session={null} t={t} />)
    const tab = within(mobileView.container).getByRole('link', { name: /events/i })
    expect(tab).toHaveAttribute('href', '/events')
    // Gleicher sichtbarer Text (Icon+Label in Sidebar vs. Icon+Label in MobileNav) — die
    // TEXT-Inhalte müssen übereinstimmen, nicht nur "enthält events".
    expect(tab.textContent?.trim()).toBe(sidebarLink.textContent?.trim())
  })
})
