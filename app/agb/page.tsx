// app/agb/page.tsx
// Platform terms of service. Basic structure only (parties, subject, account, conduct,
// liability, final provisions) — a marked placeholder pending the operator's real legal text.
import type { Metadata } from 'next'
import { LegalPlaceholderNotice } from '@/components/legal/LegalPlaceholderNotice'

export const metadata: Metadata = { title: 'Nutzungsbedingungen — BeybladeX.de' }

export default function AgbPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">Allgemeine Nutzungsbedingungen (AGB)</h1>
      <LegalPlaceholderNotice document="AGB" />

      <section aria-labelledby="agb-parties" className="space-y-2">
        <h2 id="agb-parties" className="text-lg font-medium">§ 1 Geltungsbereich und Vertragsparteien</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Wer ist Betreiber, wer ist Nutzer, wodurch kommt der Vertrag zustande (Registrierung
          + Annahme dieser Bedingungen)?]
        </p>
      </section>

      <section aria-labelledby="agb-subject" className="space-y-2">
        <h2 id="agb-subject" className="text-lg font-medium">§ 2 Leistungsgegenstand</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Beschreibung der Plattform: Community- und Sammelfunktionen, Turnierkalender,
          Regelwerk-Editor, soziale Funktionen. Hinweis, dass die Nutzung für Minderjährige
          nur mit Einwilligung der Eltern erlaubt ist.]
        </p>
      </section>

      <section aria-labelledby="agb-account" className="space-y-2">
        <h2 id="agb-account" className="text-lg font-medium">§ 3 Account, Registrierung und Kündigung</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Pflichten bei der Registrierung (wahrheitsgemäße Angaben, Geheimhaltung des
          Passworts), Kündigung durch den Nutzer jederzeit (= Account löschen unter
          Einstellungen → Konto), Kündigung/ Sperrung durch den Betreiber bei Verstößen.]
        </p>
      </section>

      <section aria-labelledby="agb-conduct" className="space-y-2">
        <h2 id="agb-conduct" className="text-lg font-medium">§ 4 Pflichten der Nutzer:innen / verbotenes Verhalten</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Keine rechtswidrigen, belästigenden oder täuschenden Inhalte; Jugendschutz;
          Umgang mit Turnierergebnissen und Bewertungen anderer.]
        </p>
      </section>

      <section aria-labelledby="agb-liability" className="space-y-2">
        <h2 id="agb-liability" className="text-lg font-medium">§ 5 Haftung</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Haftungsausschluss bzw. -beschränkung des Betreibers, gesetzliche Unabdingbarkeit
          beachten (z. B. bei Vorsatz, Körperschäden).]
        </p>
      </section>

      <section aria-labelledby="agb-final" className="space-y-2">
        <h2 id="agb-final" className="text-lg font-medium">§ 6 Schlussbestimmungen</h2>
        {/* TODO: Operator muss echten AGB-Text einfügen — Platzhalter */}
        <p>
          [Anwendbares Recht, Gerichtsstand, Salvatorische Klausel, Aktualisierungen dieser
          Bedingungen.]
        </p>
      </section>
    </main>
  )
}
