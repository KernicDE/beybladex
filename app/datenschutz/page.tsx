// app/datenschutz/page.tsx
// GDPR Art. 13 privacy notice for BeybladeX.de (issue #71). Content is the operator's
// reviewed template (kernic.net/privacy) adapted to the data this app ACTUALLY processes —
// cross-checked against prisma/schema.prisma: accounts, profiles, location (PLZ/city for the
// tournament radius), avatars, friendships, club chat, notifications, web-push tokens,
// collection/purchase records, ratings, Elo results, 2FA/passkeys, audit logs, plus the
// PWA's service-worker/IndexedDB offline storage and the theme localStorage entry. The
// version stamp below MUST stay in sync with PRIVACY_POLICY_VERSION in
// app/api/register/route.ts (consent evidence at registration).
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Datenschutzerklärung — BeybladeX.de' }

export default function DatenschutzPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">Datenschutzerklärung</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Stand: 11.09.2026 — Version 2026-09-11 (bei jeder inhaltlichen Änderung anzupassen;
        die Versionskennung muss zu <code>privacyPolicyVersion</code> in app/api/register/route.ts
        passen).
      </p>

      <section aria-labelledby="ds-controller" className="space-y-2">
        <h2 id="ds-controller" className="text-lg font-medium">1. Verantwortlicher (Art. 13 Abs. 1 lit. a DSGVO)</h2>
        <p>
          Nicolas Kerscher
          <br />
          Jourdanallee 53A
          <br />
          64546 Mörfelden-Walldorf
          <br />
          Deutschland
        </p>
        <p>
          E-Mail: nicolas@kernic.net
        </p>
      </section>

      <section aria-labelledby="ds-purposes" className="space-y-2">
        <h2 id="ds-purposes" className="text-lg font-medium">
          2. Welche Daten wir verarbeiten und warum (Art. 13 Abs. 1 lit. c DSGVO)
        </h2>
        <p>
          Wir folgen dem Prinzip der Datenminimierung: Es werden nur Daten verarbeitet, die für
          den Betrieb der Plattform technisch oder vertraglich erforderlich sind. Es findet kein
          Tracking, keine Verhaltensanalyse und keine Weitergabe zu Werbezwecken statt.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account</strong> (Benutzername, Passwort-Hash, optional E-Mail-Adresse) —
            Bereitstellung der Registrierung und Anmeldung. Rechtsgrundlage: Art. 6 Abs. 1 lit. b
            DSGVO (Vertrag).
          </li>
          <li>
            <strong>Altersprüfung und elterliche Einwilligung bei Minderjährigen</strong>{' '}
            (Geburtsdatum, E-Mail-Adresse der Eltern, Einwilligungszeitpunkt) — Rechtsgrundlage:
            Art. 6 Abs. 1 lit. c DSGVO i. V. m. Art. 8 DSGVO. Konten Minderjähriger sind bis zur
            Einwilligung der Eltern gesperrt.
          </li>
          <li>
            <strong>Profil</strong> (optional: Anzeigename, Bio, Discord-Tag, Avatar-Bild,
            Land/Bundesland, PLZ, Ort und daraus abgeleitete Koordinaten) — Anzeige deines
            Profils anderen Nutzern. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Die Sichtbarkeit
            jedes Bereichs (Profil, Standort, Sammlung, Decks, Alter) stellst du in den
            Einstellungen selbst ein; die Voreinstellungen sind datenschutzfreundlich
            (Standort: nur Freunde, Alter: privat).
          </li>
          <li>
            <strong>Benachrichtigungen</strong> — Turniere im eigenen Umkreis (PLZ/Standort,
            gewählter Radius, standardmäßig deaktiviert), E-Mail-Benachrichtigungen und
            Browser-Push-Nachrichten (beide ausdrücklich opt-in). Rechtsgrundlage:
            Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, jederzeit widerruflich in den Einstellungen).
          </li>
          <li>
            <strong>Turnierbetrieb und Rangliste</strong> — Turnieranmeldungen, Check-in,
            Match-Ergebnisse und die daraus berechnete Elo-Wertung. Rechtsgrundlage: Art. 6
            Abs. 1 lit. b und lit. f DSGVO (Durchführung der Turniere, öffentliche Rangliste).
          </li>
          <li>
            <strong>Clubs und Chat</strong> — Club-Mitgliedschaften und Club-Chat-Nachrichten.
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Chat-Nachrichten bleiben nach Löschung
            eines Accounts unter anonymisierter Kennung stehen, damit der Verlauf für andere
            Mitglieder lesbar bleibt.
          </li>
          <li>
            <strong>Sammlung</strong> (welche Teile du besitzt, optional Kaufpreis, Händler,
            Kaufdatum und Preisverlauf) — Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
          </li>
          <li>
            <strong>Community-Beiträge</strong> — Bewertungen von Builds, selbst erstellte
            Regelwerke und Katalog-Vorschläge werden mit deinem Profil verknüpft und angezeigt.
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO.
          </li>
          <li>
            <strong>Sicherheit</strong> — Zwei-Faktor-Authentifizierung (TOTP) und Passkeys
            (optional), Rate-Limiting zur Missbrauchsvermeidung sowie ein append-only Audit-Log
            sicherheitsrelevanter Verwaltungsaktionen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f
            DSGVO (berechtigtes Interesse an der IT-Sicherheit).
          </li>
          <li>
            <strong>Server-Logdateien</strong> — Beim Aufruf der Seite verarbeitet unser Server
            technisch notwendige Verbindungsdaten (u. a. IP-Adresse, Zeitpunkt, aufgerufene
            Ressource, Browserkennung) ausschließlich zur Absicherung und Fehlerbehebung des
            Betriebs. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
          </li>
        </ul>
      </section>

      <section aria-labelledby="ds-cookies" className="space-y-2">
        <h2 id="ds-cookies" className="text-lg font-medium">
          3. Cookies, lokale Speicherung und PWA-Offline-Funktion (§ 25 TDDDG)
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Session-Cookie:</strong> Zur Anmeldung setzen wir ein technisch notwendiges,
            httpOnly-Session-Cookie (JSON Web Token). Ohne dieses Cookie ist kein eingeloggter
            Betrieb möglich.
          </li>
          <li>
            <strong>Lokale Einstellungen:</strong> Deine Theme-Wahl (hell/dunkel) wird im
            LocalStorage deines Browsers gespeichert und nicht an uns übertragen.
          </li>
          <li>
            <strong>PWA-Offline-Funktion:</strong> Als installierbare Progressive Web App
            speichert der Service Worker App-Shell und Offline-Daten (Cache Storage/IndexedDB)
            lokal auf deinem Gerät. Diese Daten verlassen deinen Browser nicht; du kannst sie
            jederzeit über die Browser-Einstellungen („Website-Daten löschen") entfernen.
          </li>
        </ul>
        <p>
          Wir setzen keine Analyse-, Marketing- oder Tracking-Cookies. Eine Einwilligung zu
          nicht notwendigen Speicherungen ist daher nicht erforderlich.
        </p>
      </section>

      <section aria-labelledby="ds-recipients" className="space-y-2">
        <h2 id="ds-recipients" className="text-lg font-medium">4. Empfänger und Drittlandübermittlung</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Hosting:</strong> Die Plattform wird bei der netcup GmbH, Daimlerstraße 25,
            76185 Karlsruhe, Deutschland, gehostet (Serverstandort Deutschland). Mit dem Hoster
            besteht ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO.
          </li>
          <li>
            <strong>Kartenansichten:</strong> Kartenkacheln (OpenStreetMap) werden ausschließlich
            serverseitig über einen eigenen Proxy bezogen und 14 Tage zwischengespeichert. Dein
            Browser ruft nur unseren Server auf; an Dritte werden dabei keine Nutzerdaten
            übermittelt (OpenStreetMap sieht lediglich die IP-Adresse unseres Servers).
          </li>
          <li>
            <strong>Browser-Push:</strong> Die Zustellung von Push-Nachrichten erfolgt technisch
            über den Push-Dienst des Herstellers deines Browsers (z. B. Mozilla, Google oder
            Apple, teils außerhalb der EU). Dabei wird die technische Endpoint-URL deines
            Abonnements an diesen Dienst übermittelt — nichts darüber hinaus.
          </li>
        </ul>
        {/* Phase 5 Part B [REVIEW-FIX: privacy-dsgvo #6]: the currency conversion fetches the
            ECB euro reference rates server-side, only on cache miss. The request originates
            from our server, carries no user-identifying data, and responses are cached in
            our own Redis for 12 hours — so no user data leaves our infrastructure and no
            third party receives anything attributable to a user. */}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Währungsumrechnung in der Sammlungsverwaltung: Zur Anzeige umgerechneter Preishinweise
          ruft unser Server die amtlichen Euro-Referenzkurse der Europäischen Zentralbank
          (www.ecb.europa.eu) serverseitig ab — etwa alle 12 Stunden, bei Cache-Treffern gar
          nicht. Diese Anfrage enthält keine personenbezogenen Daten; es findet keine
          Übermittlung von Nutzerdaten an die EZB oder Dritte statt.
        </p>
      </section>

      <section aria-labelledby="ds-storage" className="space-y-2">
        <h2 id="ds-storage" className="text-lg font-medium">5. Speicherdauer</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Benachrichtigungen:</strong> Gelesene Benachrichtigungen werden nach 90
            Tagen, ungelesene nach 12 Monaten automatisch gelöscht.
          </li>
          <li>
            <strong>Push-Abonnements:</strong> werden gelöscht, sobald du sie im Browser
            abbestellst oder deinen Account löschst.
          </li>
          <li>
            <strong>Account-Daten:</strong> werden gespeichert, bis du deinen Account löschst
            (Einstellungen → Konto). Die Löschung anonymisiert dein Nutzerkonto weitgehend in
            sich selbst; Beiträge, die der Community gehören (z. B. anonymisierte Chat-Nachrichten
            und Turnierergebnisse), bleiben bestehen.
          </li>
          <li>
            <strong>Server-Logdateien:</strong> werden nur zur Absicherung des Betriebs
            ausgewertet und nach kurzer Zeit wieder gelöscht.
          </li>
        </ul>
      </section>

      <section aria-labelledby="ds-rights" className="space-y-2">
        <h2 id="ds-rights" className="text-lg font-medium">6. Betroffenenrechte (Art. 15–21 DSGVO)</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Auskunft (Art. 15)</strong> und <strong>Datenübertragbarkeit (Art. 20)</strong> —
            Export deiner Daten unter Einstellungen → Konto.
          </li>
          <li>
            <strong>Berichtigung (Art. 16)</strong> — unter Einstellungen → Profil.
          </li>
          <li>
            <strong>Löschung (Art. 17)</strong> — unter Einstellungen → Konto.
          </li>
          <li>
            <strong>Einschränkung (Art. 18)</strong>, <strong>Widerspruch (Art. 21)</strong> und{' '}
            <strong>Widerruf von Einwilligungen (Art. 7 Abs. 3)</strong> — erteilte Einwilligungen
            (z. B. Benachrichtigungen) deaktivierst du jederzeit in den Einstellungen; die
            Zulässigkeit der bis dahin erfolgten Verarbeitung bleibt unberührt.
          </li>
          <li>
            <strong>Beschwerderecht (Art. 77)</strong> bei der zuständigen Aufsichtsbehörde
            (siehe Abschnitt 7).
          </li>
        </ul>
      </section>

      <section aria-labelledby="ds-authority" className="space-y-2">
        <h2 id="ds-authority" className="text-lg font-medium">7. Aufsichtsbehörde</h2>
        <p>
          Zuständige Aufsichtsbehörde ist der Hessische Beauftragte für Datenschutz und
          Informationsfreiheit, Postfach 3163, 65021 Wiesbaden (der Betreiber ist in Hessen
          ansässig).
        </p>
      </section>
    </main>
  )
}
