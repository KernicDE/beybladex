// app/page.tsx
// Landing page (Task 13 decision, binding): guests get a hero + "was ist
// BeybladeX.de" + register CTA — Phase 3 adds the upcoming-DACH-events teaser once
// the event query exists; logged-in users get a personalized welcome with links
// into the app's primary surfaces. Real dashboard data (next tournament, club
// activity, new parts) lands with Phases 3–5 — these are links, not live data.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { BrandMark } from '@/components/brand/BrandMark'

const PRIMARY_LINKS = [
  { href: '/decks', title: 'Decks', description: 'Verwalte deine Turnier-Decks.' },
  { href: '/collection', title: 'Sammlung', description: 'Erfasse deine Teile und builds.' },
  { href: '/clubs', title: 'Clubs', description: 'Finde Beyblade-Clubs in deiner Nähe.' },
] as const

export default async function Home() {
  const session = await auth()

  if (session?.user?.name) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">
          Willkommen zurück, {session.user.name}
        </h1>
        <div className="grid gap-4 sm:grid-cols-3">
          {PRIMARY_LINKS.map(({ href, title, description }) => (
            <Link key={href} href={href} className="block transition-opacity hover:opacity-80">
              <Card>
                <h2 className="font-semibold text-x-cyan-text dark:text-x-cyan">{title}</h2>
                <p className="mt-1 text-sm text-current/60">{description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 p-6 text-center">
      <BrandMark size={56} />
      <h1 className="text-4xl font-bold tracking-tight text-x-cyan-text dark:text-x-cyan">
        BeybladeX.de
      </h1>
      <p className="text-lg font-medium">
        Die Plattform für Beyblade X Turniere in der DACH-Region.
      </p>
      <p className="max-w-xl text-current/70">
        Finde Events und Clubs in deiner Nähe, verwalte deine Sammlung und deine
        Decks — und tritt gegen andere Blader an.
        {/* TODO(Phase 3): upcoming DACH events teaser goes here, reusing the /events query. */}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/register"
          className="rounded-md bg-x-cyan px-6 py-3 font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
        >
          Jetzt registrieren
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-current/30 px-6 py-3 font-medium transition-colors hover:bg-current/5"
        >
          Anmelden
        </Link>
      </div>
    </main>
  )
}
