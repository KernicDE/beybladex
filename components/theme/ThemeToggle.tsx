// components/theme/ThemeToggle.tsx
'use client'
import { useTheme } from './ThemeProvider'

const ORDER = ['system', 'dark', 'light'] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(next)
  }
  return (
    <button aria-label="Toggle theme" onClick={cycle} className="rounded px-3 py-2 text-sm">
      {theme}
    </button>
  )
}
