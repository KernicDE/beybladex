// components/legal/LegalPlaceholderNotice.tsx
// Visually unmissable on-page marker that the legal text below is a STRUCTURAL PLACEHOLDER.
// The operator MUST replace each page's content with reviewed legal copy before launch —
// a code comment would never be seen by the person who needs to act on this, so the notice
// is rendered on the page itself (Task 12: routes and page shape are the code deliverable,
// not the legal copy).
export function LegalPlaceholderNotice({ document }: { document: string }) {
  return (
    <div
      role="note"
      aria-label="Platzhalter-Hinweis"
      className="rounded-md border-2 border-dashed border-type-attack bg-type-attack/10 p-4 text-sm text-type-attack"
    >
      <p className="font-semibold">⚠ PLATZHALTER — KEIN RECHTSGÜLTIGER TEXT</p>
      <p className="mt-1">
        Diese Seite („{document}“) enthält nur Struktur-Platzhalter. Der Betreiber muss hier den
        geprüften echten Text einfügen, bevor die Plattform öffentlich erreichbar ist.
      </p>
    </div>
  )
}
