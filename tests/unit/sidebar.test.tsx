// tests/unit/sidebar.test.tsx (#157 — Nutzer-Feedback "Verschiebung des Menüs auf die Seite")
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import deMessages from '@/lib/i18n/messages/de.json'

const t = deMessages

vi.mock('next/navigation', () => ({ usePathname: () => '/builds/abc' }))

function renderSidebar(session: { user: { id: string; name: string } } | null = null) {
  return render(
    <ThemeProvider>
      <Sidebar session={session as never} avatarImageId={null} unreadNotifications={0} t={t} />
    </ThemeProvider>,
  )
}

beforeEach(() => localStorage.clear())

describe('Sidebar (#157)', () => {
  it('markiert die aktuelle Route (auch auf einer Unterseite, /builds/abc → /builds) als aktiv', () => {
    renderSidebar()
    const buildsLink = screen.getByRole('link', { name: 'Builds' })
    expect(buildsLink).toHaveAttribute('aria-current', 'page')
    const eventsLink = screen.getByRole('link', { name: 'Events' })
    expect(eventsLink).not.toHaveAttribute('aria-current')
  })

  it('auth-gated Links tragen ein Schloss-Label, wenn keine Session vorhanden ist', () => {
    renderSidebar(null)
    expect(screen.getByRole('link', { name: /Decks \(Anmeldung erforderlich\)/ })).toBeInTheDocument()
  })

  it('Einklappen versteckt die Nav-Labels und persistiert den Zustand in localStorage', () => {
    renderSidebar()
    expect(screen.getByText('Events')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Leiste einklappen' }))
    expect(screen.queryByText('Events')).not.toBeInTheDocument()
    expect(localStorage.getItem('beybladex-sidebar-collapsed')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Leiste ausklappen' }))
    expect(screen.getByText('Events')).toBeInTheDocument()
    expect(localStorage.getItem('beybladex-sidebar-collapsed')).toBe('0')
  })

  it('zeigt keinen Sprach-/Theme-Umschalter mehr (Live-Nachtrag: "das ist entweder vom System oder im Nutzermenü")', () => {
    renderSidebar()
    expect(screen.queryByRole('group', { name: 'Farbschema' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /Sprache|Language/i })).not.toBeInTheDocument()
  })

  it('zeigt einen Einstellungen-Link für eine Session (Live-Report: "Wo ist der Adminbereich hin?" — /settings ist der einzige Weg dorthin)', () => {
    renderSidebar({ user: { id: 'u1', name: 'kernic' } })
    expect(screen.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '/settings')
  })

  it('zeigt Login-Link für Gäste, Avatar+Abmelden für eine Session', () => {
    const { rerender } = render(
      <ThemeProvider>
        <Sidebar session={null} avatarImageId={null} unreadNotifications={0} t={t} />
      </ThemeProvider>,
    )
    expect(screen.getByRole('link', { name: t.common.login })).toBeInTheDocument()

    rerender(
      <ThemeProvider>
        <Sidebar
          session={{ user: { id: 'u1', name: 'kernic' } } as never}
          avatarImageId={null}
          unreadNotifications={2}
          t={t}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText('kernic')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeInTheDocument()
  })
})
