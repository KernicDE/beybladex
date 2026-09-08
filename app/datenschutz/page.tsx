// app/datenschutz/page.tsx
// GDPR Art. 13 privacy notice. Section structure follows Art. 13(1)(a)–(f): controller,
// purposes + legal bases, recipients, storage periods, data-subject rights, supervisory
// authority. All content is a marked placeholder pending the operator's real legal text.
import type { Metadata } from 'next'
import { LegalPlaceholderNotice } from '@/components/legal/LegalPlaceholderNotice'

export const metadata: Metadata = { title: 'Datenschutzerklärung — BeybladeX.de' }

export default function DatenschutzPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">Datenschutzerklärung</h1>
      <LegalPlaceholderNotice document="Datenschutzerklärung" />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Stand (Platzhalter): 08.09.2026 — Version 2026-09-08 (bei jeder inhaltlichen Änderung
        anzupassen; die Versionskennung muss zu <code>privacyPolicyVersion</code> in
        app/api/register/route.ts passen).
      </p>

      <section aria-labelledby="ds-controller" className="space-y-2">
        <h2 id="ds-controller" className="text-lg font-medium">1. Verantwortlicher (Art. 13 Abs. 1 lit. a DSGVO)</h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <p>
          [Name und Kontaktdaten des Verantwortlichen — identisch mit dem Impressum]
          <br />
          E-Mail Datenschutz: [E-Mail-Adresse]
        </p>
      </section>

      <section aria-labelledby="ds-purposes" className="space-y-2">
        <h2 id="ds-purposes" className="text-lg font-medium">
          2. Zwecke und Rechtsgrundlagen der Verarbeitung (Art. 13 Abs. 1 lit. c DSGVO)
        </h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <ul className="list-disc pl-5">
          <li>
            Bereitstellung des Accounts und der Plattform (Benutzername, Passwort-Hash,
            Profildaten) — Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertrag).
          </li>
          <li>
            Altersprüfung und elterliche Einwilligung bei Minderjährigen (Geburtsdatum,
            E-Mail der Eltern) — Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO (Art. 8 DSGVO).
          </li>
          <li>
            Benachrichtigungen über Turniere im eigenen Umkreis (Postleitzahl, Standort,
            optional E-Mail) — Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung,
            jederzeit widerruflich in den Einstellungen).
          </li>
          <li>
            Sicherheit der Anmeldung (2FA/Passkeys, Rate-Limiting, Logs) — Rechtsgrundlage:
            Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der IT-Sicherheit).
          </li>
        </ul>
      </section>

      <section aria-labelledby="ds-recipients" className="space-y-2">
        <h2 id="ds-recipients" className="text-lg font-medium">3. Empfänger und Drittlandübermittlung</h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <p>
          [Hosting-Anbieter inkl. Serverstandort, E-Mail-Versanddienst, ggf. Auftragsverarbeiter
          nach Art. 28 DSGVO; dokumentieren, dass Kartenkacheln serverseitig über einen eigenen
          Proxy bezogen werden und der Browser keine Daten an Dritte sendet.]
        </p>
      </section>

      <section aria-labelledby="ds-storage" className="space-y-2">
        <h2 id="ds-storage" className="text-lg font-medium">4. Speicherdauer</h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <p>
          [Löschfristen je Datenkategorie; Hinweis auf Löschung/Anonymisierung beim
          Account-Löschen (Art. 17) und auf die Benachrichtigungs-Aufbewahrungsfristen:
          gelesene Benachrichtigungen 90 Tage, ungelesene 12 Monate.]
        </p>
      </section>

      <section aria-labelledby="ds-rights" className="space-y-2">
        <h2 id="ds-rights" className="text-lg font-medium">5. Betroffenenrechte (Art. 15–21 DSGVO)</h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <ul className="list-disc pl-5">
          <li>Auskunft (Art. 15) und Datenübertragbarkeit (Art. 20) — Export unter Einstellungen → Konto.</li>
          <li>Berichtigung (Art. 16) — unter Einstellungen → Profil.</li>
          <li>Löschung (Art. 17) — unter Einstellungen → Konto.</li>
          <li>Einschränkung (Art. 18), Widerspruch (Art. 21), Widerruf von Einwilligungen (Art. 7 Abs. 3).</li>
          <li>Beschwerderecht bei der Aufsichtsbehörde (siehe Abschnitt 6).</li>
        </ul>
      </section>

      <section aria-labelledby="ds-authority" className="space-y-2">
        <h2 id="ds-authority" className="text-lg font-medium">6. Aufsichtsbehörde</h2>
        {/* TODO: Operator muss echten Datenschutz-Text einfügen — Platzhalter */}
        <p>
          [Zuständige Landesdatenschutzaufsicht des Betreibers, z. B. der/die Landesbeauftragte
          für Datenschutz und Informationsfreiheit des Bundeslandes, in dem der Verantwortliche
          ansässig ist.]
        </p>
      </section>
    </main>
  )
}
