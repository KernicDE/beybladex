// tests/unit/theme-toggle.test.tsx (RC16 #124)
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

beforeEach(() => localStorage.clear())

describe('ThemeToggle (#124 — Icon-Segment statt Text-Cycler)', () => {
  it('bietet alle drei Optionen direkt an und markiert den aktiven Zustand per aria-pressed', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    const group = screen.getByRole('group', { name: 'Farbschema' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Helles Design', 'Dunkles Design', 'System-Design'])
    // Default: system ist aktiv.
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  it('waehlt per Klick und persistiert in localStorage', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    const group = screen.getByRole('group', { name: 'Farbschema' })
    const buttons = within(group).getAllByRole('button')

    fireEvent.click(buttons[1]!) // Dunkles Design
    expect(localStorage.getItem('beybladex-theme')).toBe('dark')
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(buttons[0]!) // Helles Design
    expect(localStorage.getItem('beybladex-theme')).toBe('light')
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true')
  })
})
