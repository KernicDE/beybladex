// components/ui/ExpandIconLink.tsx (#157 — "Kontext-Aware-Interaktionen: Icon-Buttons
// expandieren sanft beim Hover (🔍 → 'Suchen', + → 'Neues Set eintragen')")
// Reines Icon in Ruhe, Label schiebt sich bei Hover/Fokus sanft daneben — matcht das Referenz-
// Mockup exakt (`.expand-btn` in ~/Downloads/beybladex-design-konzepte/6-beyblade-x-arena.html).
// BEWUSST nur für Controls verwendet, die auch ohne das Label eindeutig sind (Icon + aria-label
// tragen die volle Bedeutung) UND wo hauptsächlich mit Maus/Tastatur (Hover/Fokus) interagiert
// wird — für primäre Touch-Aktionen (z. B. "Neuer Build") bleibt das Label dauerhaft sichtbar:
// ein :hover-Reveal existiert auf Touch-Geräten schlicht nicht, ein rein ikonischer Button ohne
// Label wäre dort unauffindbar/mehrdeutig. Diese Komponente ist daher an den EINEN Ort gebunden,
// wo genau das zutrifft: die Sidebar (Desktop-only, siehe Sidebar.tsx).
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

export function ExpandIconLink({
  href,
  icon: Icon,
  label,
  className = '',
}: {
  href: string
  icon: LucideIcon
  label: string
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`group inline-flex items-center overflow-hidden rounded-md p-1.5 text-current/70 transition-colors hover:bg-current/5 hover:text-current focus-visible:outline-2 focus-visible:outline-x-cyan-text ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-out group-hover:ml-2 group-hover:max-w-[160px] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[160px] group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </Link>
  )
}
