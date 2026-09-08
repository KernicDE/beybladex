// app/settings/account/page.tsx
// Server component: renders the Art. 20 export entry point and the Art. 17 erasure form.
// Deletion requires re-confirmation (password or current TOTP token) — see DELETE /api/account.
import { auth } from '@/lib/auth'
import { AccountPanel } from '@/components/settings/AccountPanel'

export const dynamic = 'force-dynamic'

export default async function SettingsAccountPage() {
  const session = await auth()

  return (
    <section aria-labelledby="account-heading" className="space-y-6">
      <h2 id="account-heading" className="text-xl font-semibold">Konto</h2>

      <div className="space-y-3">
        <h3 className="font-medium">Datenexport (Art. 20 DSGVO)</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Lade alle zu deinem Konto gehörenden Daten als JSON-Datei herunter — Profil, Sammlung,
          Decks, Freundschaften, Club-Mitgliedschaften, Benachrichtigungs-Einstellungen und
          Turnier-Teilnahmen.
        </p>
        <a
          href="/api/account/export"
          className="inline-block rounded-md bg-x-cyan px-4 py-2 font-medium text-base-dark focus-visible:outline-2 focus-visible:outline-x-cyan"
        >
          Meine Daten exportieren
        </a>
      </div>

      <div className="space-y-3 border-t border-zinc-300 pt-4 dark:border-zinc-700">
        <h3 className="font-medium">Konto löschen (Art. 17 DSGVO)</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <strong className="text-type-attack">Unwiderruflich.</strong> Dein Konto wird anonymisiert:
          persönliche Daten (E-Mail, Passwort, Geburtsdatum, Wohnort u. a.) werden gelöscht, dein
          Benutzername wird freigegeben. Daten, an denen andere Nutzer:innen ein berechtigtes
          Interesse haben (z. B. Turnierergebnisse, Clubs, Regelwerke), bleiben anonymisiert
          bestehen. Clubs, deren einzige Admin du bist, werden aufgelöst.
        </p>
        <AccountPanel username={session!.user!.name ?? ''} />
      </div>
    </section>
  )
}
