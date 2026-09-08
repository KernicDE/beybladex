// tests/unit/theme-toggle.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

beforeEach(() => localStorage.clear())

describe('ThemeToggle', () => {
  it('cycles system -> dark -> light -> system and persists to localStorage', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
    const btn = screen.getByRole('button', { name: /theme/i })
    fireEvent.click(btn)
    expect(localStorage.getItem('beybladex-theme')).toBe('dark')
    fireEvent.click(btn)
    expect(localStorage.getItem('beybladex-theme')).toBe('light')
    fireEvent.click(btn)
    expect(localStorage.getItem('beybladex-theme')).toBe('system')
  })
})
