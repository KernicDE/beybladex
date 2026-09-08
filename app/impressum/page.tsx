// app/impressum/page.tsx
// DDG §5 (Digitale-Dienste-Gesetz) statutory provider disclosure — a standalone German legal
// requirement independent of GDPR. Structure follows DDG §5(1); all content is a marked
// placeholder pending the operator's real legal text (see LegalPlaceholderNotice).
import type { Metadata } from 'next'
import { LegalPlaceholderNotice } from '@/components/legal/LegalPlaceholderNotice'

export const metadata: Metadata = { title: 'Impressum — BeybladeX.de' }

export default function ImpressumPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan">Impressum</h1>
      <LegalPlaceholderNotice document="Impressum" />

      <section aria-labelledby="impressum-provider" className="space-y-2">
        <h2 id="impressum-provider" className="text-lg font-medium">Diensteanbieter</h2>
        {/* TODO: Operator muss echten Impressum-Text einfügen — Platzhalter */}
        <p>
          [Vor- und Nachname bzw. Firmenname des Betreibers]
          <br />
          [Straße und Hausnummer]
          <br />
          [PLZ und Ort]
          <br />
          [Land]
        </p>
      </section>

      <section aria-labelledby="impressum-contact" className="space-y-2">
        <h2 id="impressum-contact" className="text-lg font-medium">Kontakt</h2>
        {/* TODO: Operator muss echten Impressum-Text einfügen — Platzhalter */}
        <p>
          Telefon: [Telefonnummer]
          <br />
          E-Mail: [E-Mail-Adresse]
        </p>
      </section>

      <section aria-labelledby="impressum-legal" className="space-y-2">
        <h2 id="impressum-legal" className="text-lg font-medium">
          Registrierungs- und Aufsichtsangaben (falls einschlägig)
        </h2>
        {/* TODO: Operator muss echten Impressum-Text einfügen — Platzhalter */}
        <p>
          Handelsregister / Vereinsregister: [Nummer und Registergericht, falls vorhanden]
          <br />
          Umsatzsteuer-Identifikationsnummer: [USt-IdNr., falls vorhanden]
          <br />
          Verantwortliche:r für den Inhalt nach § 18 Abs. 2 MStV: [Name und Anschrift]
        </p>
      </section>
    </main>
  )
}
