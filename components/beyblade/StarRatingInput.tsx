// components/beyblade/StarRatingInput.tsx (RC16 #107)
// Hover-Sterne statt Dropdown: 5 native Radio-Inputs (Pfeiltasten/Screenreader bleiben
// nutzbar), visuell als ★ gerendert. Hover hebt eine Vorschau hervor (onMouseEnter je Stern,
// onMouseLeave fällt auf den gewählten Wert zurück), Klick setzt den tatsächlichen Wert.
// Farben: gewählte/hovered Sterne gold (bestehendes --color-type-stamina-Token), Rest grau
// (current/30) — kein neuer Farbwert.
'use client'

import { useId, useState } from 'react'

export function StarRatingInput({
  value,
  onChange,
}: {
  /** Aktuell gewählte Sternanzahl (1–5). */
  value: number
  onChange: (stars: number) => void
}) {
  const name = useId()
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value

  return (
    <div role="radiogroup" aria-label="Sterne" className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} onMouseEnter={() => setHover(n)} className="cursor-pointer p-0.5">
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="sr-only"
          />
          <span aria-hidden="true" className={`text-2xl leading-none transition-colors ${n <= shown ? 'text-type-stamina' : 'text-current/30'}`}>
            ★
          </span>
          <span className="sr-only">{n} Sterne</span>
        </label>
      ))}
    </div>
  )
}
