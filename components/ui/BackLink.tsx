// components/ui/BackLink.tsx (#164)
// "← Zurück"-Navigation auf Detailseiten — vorher ein kleiner, unauffälliger Text-Link oben
// links ("reingequetscht"), jetzt ein eigener, klar sichtbarer Button-artiger Link im selben
// Stil wie die sekundären Buttons der Seiten (border + hover-Fläche statt reinem Unterstrich).
import Link from 'next/link'

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-current/20 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-current/5"
    >
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  )
}
