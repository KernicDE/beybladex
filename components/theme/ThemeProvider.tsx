// components/theme/ThemeProvider.tsx
'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
type Ctx = { theme: Theme; resolvedTheme: 'light' | 'dark'; setTheme: (t: Theme) => void }
const STORAGE_KEY = 'beybladex-theme'
const ThemeContext = createContext<Ctx | null>(null)

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (stored) setThemeState(stored)
  }, [])

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
