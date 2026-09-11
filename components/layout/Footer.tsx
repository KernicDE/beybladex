// components/layout/Footer.tsx
// Desktop-only static footer with legal page links (Impressum, Datenschutz)
// and the deploy version (issue #77) so any visitor can reference the running build
// in bug reports; the machine-readable form is /api/version.
import Link from 'next/link'
import { LEGAL_LINKS } from '@/components/layout/legalLinks'
import { APP_VERSION } from '@/lib/version'

export function Footer() {
  return (
    <footer className="hidden border-t border-x-cyan/20 px-4 py-6 text-sm text-current/60 md:block md:px-8">
      <div className="flex items-center justify-between gap-4">
        <p>© {new Date().getFullYear()} BeybladeX.de</p>
        <p aria-label="Version">v{APP_VERSION}</p>
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
