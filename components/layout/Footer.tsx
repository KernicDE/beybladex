// components/layout/Footer.tsx
// Desktop-only static footer; Task 13 adds the legal page links (Impressum, Datenschutz, AGB).
export function Footer() {
  return (
    <footer className="hidden border-t border-x-cyan/20 px-4 py-6 text-sm text-current/60 md:block md:px-8">
      <p>© {new Date().getFullYear()} BeybladeX.de</p>
    </footer>
  )
}
