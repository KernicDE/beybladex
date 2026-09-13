// components/theme/ThemeToggle.tsx (RC16 #124)
// Theme-Umschalter als Icon-Segment (Sonne/Mond/Monitor aus lucide-react) statt reiner
// Text-Labels. Der aktive Zustand ist visuell hervorgehoben (gefüllter Hintergrund + aria-pressed),
// nicht nur per Text erkennbar.
'use client'
import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const OPTIONS: Array<{ id: 'light' | 'dark' | 'system'; label: string; Icon: LucideIcon }> = [
  { id: 'light', label: 'Helles Design', Icon: Sun },
  { id: 'dark', label: 'Dunkles Design', Icon: Moon },
  { id: 'system', label: 'System-Design', Icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div role="group" aria-label="Farbschema" className="flex overflow-hidden rounded-md border border-current/20">
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = theme === id
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={`px-2.5 py-2 transition-colors ${
              active ? 'bg-x-cyan/20 text-x-cyan-text dark:text-x-cyan' : 'text-current/60 hover:bg-current/5 hover:text-current'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
