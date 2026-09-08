// components/layout/Footer.tsx
// Desktop-only static footer with legal page links (Impressum, Datenschutz, AGB).
import Link from 'next/link'

const LEGAL_LINKS = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/datenschutz', label: 'Datenschutz' },
  { href: '/agb', label: 'AGB' },
] as const

export function Footer() {
  return (
    <footer className="hidden border-t border-x-cyan/20 px-4 py-6 text-sm text-current/60 md:block md:px-8">
      <div className="flex items-center justify-between gap-4">
        <p>© {new Date().getFullYear()} BeybladeX.de</p>
        <nav aria-label="Rechtliches">
          <ul className="flex items-center gap-4">
            {LEGAL_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className="transition-colors hover:text-current">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
