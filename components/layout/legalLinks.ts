// components/layout/legalLinks.ts
// Single source of truth for the legal pages (Impressum/Datenschutz), shared by
// Footer (desktop), UserMenu (logged-in mobile path) and GuestLegalMenu (guest path —
// issue #22: guests had no path to these pages at all below the `md` breakpoint, since
// the Footer is desktop-only and UserMenu only renders for a signed-in session).
// RC12 #85: AGB removed — private, non-commercial site without terms of service.
export const LEGAL_LINKS = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/datenschutz', label: 'Datenschutz' },
] as const
