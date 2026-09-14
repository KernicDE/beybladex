// components/theme/ThemeToggle.tsx (RC16 #124; #157 Ursprüngliche Anforderung — "Einheitliche
// Designelemente (aktuell Sprache per Dropdown, Farbschema aber 3er Auswahl)" /
// "Minimalistisch: was selten gebraucht wird, muss nicht immer sichtbar sein — Sprache oder
// Farbschema ändert man nicht dauernd.")
// Vorher: drei immer sichtbare Icon-Buttons (Sonne/Mond/Monitor) in einer Reihe — genau die im
// Issue benannte Inkonsistenz zum Sprach-Switcher (components/layout/LanguageSwitcher.tsx), der
// nur EIN Flaggen-Icon zeigt und die übrigen Optionen erst bei Hover/Fokus aufklappt. Jetzt
// dasselbe Muster: ein Icon (das aktuelle Theme), die anderen zwei Optionen erscheinen als
// Dropdown bei Hover/Fokus — visuell und strukturell identisch zu LanguageSwitcher, damit beide
// "selten gebrauchten" Controls einheitlich wenig Platz beanspruchen.
'use client'
import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const OPTIONS: Array<{ id: 'light' | 'dark' | 'system'; label: string; Icon: LucideIcon }> = [
  { id: 'light', label: 'Helles Design', Icon: Sun },
  { id: 'dark', label: 'Dunkles Design', Icon: Moon },
  { id: 'system', label: 'System-Design', Icon: Monitor },
]

export function ThemeToggle({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { theme, setTheme } = useTheme()
  const current = OPTIONS.find((o) => o.id === theme) ?? OPTIONS[2]!

  return (
    <div className="group relative inline-block" role="group" aria-label="Farbschema">
      <button
        type="button"
        aria-label={`Farbschema: ${current.label}`}
        aria-haspopup="listbox"
        title={current.label}
        className="rounded-md p-1.5 text-current/70 transition-colors hover:bg-current/5 hover:text-current focus-visible:outline-2 focus-visible:outline-x-cyan-text"
      >
        <current.Icon className="h-4 w-4" aria-hidden="true" />
      </button>
      <ul
        role="listbox"
        aria-label="Farbschema"
        // #157-Nachtrag (Live-Report, Sidebar-Screenshot: Dropdown lief bei rechtsbündiger
        // Ausrichtung links über den Viewport-Rand hinaus) — die Sidebar sitzt am linken Rand,
        // ein von dort aus rechtsbündig geöffnetes Dropdown hat keinen Platz. `align="left"`
        // öffnet stattdessen nach rechts (Sidebar-Call-Site); Header behält die alte
        // rechtsbündige Standardausrichtung (dort sitzt der Trigger selbst rechts im Screen).
        className={`invisible absolute top-full z-50 mt-1 min-w-max rounded-md border border-current/15 bg-white p-1 shadow-lg group-focus-within:visible group-hover:visible dark:bg-base-dark-alt ${
          align === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        {OPTIONS.map(({ id, label, Icon }) => {
          const active = theme === id
          return (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                aria-label={label}
                onClick={() => setTheme(id)}
                className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors ${
                  active ? 'bg-x-cyan/20 text-x-cyan-text dark:text-x-cyan' : 'text-zinc-900 hover:bg-current/5 dark:text-zinc-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
