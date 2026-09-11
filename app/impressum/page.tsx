// app/impressum/page.tsx
// DDG §5 (Digitale-Dienste-Gesetz) statutory provider disclosure — a standalone German legal
// requirement independent of GDPR. Content follows the operator's reviewed template
// (kernic.net/imprint), adapted for BeybladeX.de (issue #71). Contact mailbox for this
// service: nicolas@kernic.net.
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Impressum — BeybladeX.de' }

export default function ImpressumPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">Impressum</h1>

      <section aria-labelledby="impressum-provider" className="space-y-2">
        <h2 id="impressum-provider" className="text-lg font-medium">Diensteanbieter</h2>
        <p>
          Nicolas Kerscher
          <br />
          Jourdanallee 53A
          <br />
          64546 Mörfelden-Walldorf
          <br />
          Deutschland
        </p>
      </section>

      <section aria-labelledby="impressum-contact" className="space-y-2">
        <h2 id="impressum-contact" className="text-lg font-medium">Kontakt</h2>
        <p>
          Telefon: +49 6105 403 816 4
          <br />
          E-Mail: nicolas@kernic.net
        </p>
      </section>

      <section aria-labelledby="impressum-editorial" className="space-y-2">
        <h2 id="impressum-editorial" className="text-lg font-medium">
          Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
        </h2>
        <p>
          Nicolas Kerscher
          <br />
          Jourdanallee 53A
          <br />
          64546 Mörfelden-Walldorf
          <br />
          Deutschland
        </p>
      </section>

      <section aria-labelledby="impressum-odr" className="space-y-2">
        <h2 id="impressum-odr" className="text-lg font-medium">
          EU-Streitschlichtung
        </h2>
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-x-cyan-text dark:hover:text-x-cyan"
          >
            https://ec.europa.eu/consumers/odr/
          </a>
          . Unsere E-Mail-Adresse finden Sie oben im Impressum.
        </p>
        <p>
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </section>

      <section aria-labelledby="impressum-content-liability" className="space-y-2">
        <h2 id="impressum-content-liability" className="text-lg font-medium">Haftung für Inhalte</h2>
        <p>
          Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen
          Gesetzen verantwortlich (§ 7 Abs. 1 DDG). Nach §§ 8 bis 10 DDG sind wir als
          Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
          Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
          Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
          Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
        </p>
      </section>

      <section aria-labelledby="impressum-link-liability" className="space-y-2">
        <h2 id="impressum-link-liability" className="text-lg font-medium">Haftung für Links</h2>
        <p>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr
          übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder
          Betreiber der Seiten verantwortlich.
        </p>
      </section>

      <section aria-labelledby="impressum-copyright" className="space-y-2">
        <h2 id="impressum-copyright" className="text-lg font-medium">Urheberrecht</h2>
        <p>
          Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
          dem deutschen Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet. Die
          Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der
          Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors
          bzw. Erstellers. Downloads und Kopien dieser Seite sind nur für den privaten, nicht
          kommerziellen Gebrauch gestattet.
        </p>
      </section>
    </main>
  )
}
