// components/layout/legalLinks.ts
// Single source of truth for the legal pages (Impressum/Datenschutz), shared by
// Footer (desktop), UserMenu (logged-in mobile path) and GuestLegalMenu (guest path —
// issue #22: guests had no path to these pages at all below the `md` breakpoint, since
// the Footer is desktop-only and UserMenu only renders for a signed-in session).
// RC12 #85: AGB removed — private, non-commercial site without terms of service.
// RC14 #17 — `label` stays the German fallback for the not-yet-internationalized client
// menus (UserMenu/GuestLegalMenu); `labelKey` is the dictionary key the Footer (server,
// request-localized) resolves per request.
export const LEGAL_LINKS = [
  { href: '/impressum', label: 'Impressum', labelKey: 'imprint' },
  { href: '/datenschutz', label: 'Datenschutz', labelKey: 'privacy' },
] as const
