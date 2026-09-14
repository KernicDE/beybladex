// tests/unit/theme-toggle.test.tsx (RC16 #124; #157 — vereinheitlicht mit LanguageSwitcher:
// ein Icon-Button zeigt das aktuelle Theme, die übrigen Optionen klappen als Dropdown bei
// Hover/Fokus auf, statt immer alle drei nebeneinander zu zeigen.)
import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

beforeEach(() => localStorage.clear())

describe('ThemeToggle (#157 — Icon + Hover/Fokus-Dropdown statt immer sichtbarer 3er-Reihe)', () => {
  it('zeigt standardmäßig nur EIN Icon (aktuelles Theme), Optionen sind erst im Dropdown', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    // Default: System-Design ist aktiv → der sichtbare Trigger-Button trägt dessen Label.
    expect(screen.getByRole('button', { name: 'Farbschema: System-Design' })).toBeInTheDocument()
    const list = screen.getByRole('listbox', { name: 'Farbschema' })
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['Helles Design', 'Dunkles Design', 'System-Design'])
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
  })

  it('wählt per Klick im Dropdown und persistiert in localStorage, Trigger-Button aktualisiert sein Label', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    const list = screen.getByRole('listbox', { name: 'Farbschema' })
    fireEvent.click(within(list).getByRole('option', { name: 'Dunkles Design' }))

    expect(localStorage.getItem('beybladex-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Farbschema: Dunkles Design' })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Dunkles Design' })).toHaveAttribute('aria-selected', 'true')
  })
})
