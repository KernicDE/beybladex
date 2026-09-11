// components/home/GuestLanding.tsx (RC13 issue #88)
// The guest home page as a full marketing page: hero, feature overview, screenshot gallery
// (decorative mockups, see LandingScreenshotMockups), upcoming-events teaser, DACH-community
// info, and a closing register CTA. Presentational by design — app/page.tsx fetches the
// teaser events and passes plain props. Pure server components, zero client JS, so the
// guest page stays fully static-renderable per request without any hydration shift.
// Design tokens only (x-cyan / x-cyan-text, Card, existing button idioms) — no parallel
// design language (see also globals.css's USAGE RULE on text-x-cyan vs. text-x-cyan-text).
import Link from 'next/link'
import { BookOpen, Calendar, Layers, Package, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { Card } from '@/components/ui/Card'
import { LandingEventTeaser, type LandingTeaserEvent } from '@/components/home/LandingEventTeaser'
import { LandingScreenshotMockups } from '@/components/home/LandingScreenshotMockups'

interface Feature {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

// #88 — only features that actually exist today; no promises about non-existent functions.
const FEATURES: Feature[] = [
  {
    href: '/events',
    icon: Calendar,
    title: 'Events & Turniere',
    description: 'Finde Events in der DACH-Region, melde dich an — mit Check-in und Live-Scoring direkt auf der Plattform.',
  },
  {
    href: '/clubs',
    icon: Users,
    title: 'Clubs & Community',
    description: 'Finde Beyblade-Clubs in deiner Nähe, tritt bei und bleib über die Club-Karte und den Chat mit deinen Mitbladern verbunden.',
  },
  {
    href: '/decks',
    icon: Layers,
    title: 'Deck-Builder',
    description: 'Baue deine Turnier-Decks und prüfe sie direkt gegen die Deck-Regeln deines Formats.',
  },
  {
    href: '/collection',
    icon: Package,
    title: 'Sammlungsverwaltung',
    description: 'Erfasse deine Beyblades, Teile und Builds — dein Inventar, immer griffbereit.',
  },
  {
    href: '/rangliste',
    icon: TrendingUp,
    title: 'Rangliste & Meta',
    description: 'ELO-Rangliste, Statistiken und ein Blick darauf, welche Teile sich in der Meta durchsetzen.',
  },
  {
    href: '/rules',
    icon: BookOpen,
    title: 'Regelwerk',
    description: 'Das offizielle Regelwerk mit Checklisten — vom Aufbau des Stadiums bis zu den WBO-Deck-Bestimmungen.',
  },
]

const CTA_PRIMARY_CLASSES =
  'rounded-md bg-x-cyan px-6 py-3 font-medium text-base-dark transition-colors hover:bg-x-cyan/85'
const CTA_SECONDARY_CLASSES =
  'rounded-md border border-current/30 px-6 py-3 font-medium transition-colors hover:bg-current/5'

const DACH_REGIONS = [
  { code: 'DE', label: 'Deutschland' },
  { code: 'AT', label: 'Österreich' },
  { code: 'CH', label: 'Schweiz' },
] as const

export function GuestLanding({ upcomingEvents }: { upcomingEvents: LandingTeaserEvent[] }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 p-4 sm:p-6">
      {/* Hero — the register CTA stays the page's primary action. */}
      <section className="flex flex-col items-center gap-5 pt-6 text-center">
        <BrandMark size={64} />
        <h1 className="text-4xl font-bold tracking-tight text-x-cyan-text dark:text-x-cyan">
          BeybladeX.de
        </h1>
        <p className="text-lg font-medium">
          Die Plattform für Beyblade X Turniere in der DACH-Region.
        </p>
        <p className="max-w-xl text-current/70">
          Finde Events und Clubs in deiner Nähe, verwalte deine Sammlung und deine Decks —
          und tritt gegen andere Blader an.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className={CTA_PRIMARY_CLASSES}>
            Jetzt registrieren
          </Link>
          <Link href="/login" className={CTA_SECONDARY_CLASSES}>
            Anmelden
          </Link>
        </div>
      </section>

      {/* Feature overview — each card deep-links into the real feature. */}
      <section aria-labelledby="landing-features-heading">
        <h2 id="landing-features-heading" className="text-2xl font-semibold">
          Alles für dein X-Abenteuer
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={href} className="block transition-opacity hover:opacity-80">
              <Card className="h-full">
                <Icon size={24} aria-hidden="true" className="text-x-cyan-text dark:text-x-cyan" />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-current/60">{description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Screenshot gallery — decorative mockup frames until real assets exist (#88). */}
      <section aria-labelledby="landing-gallery-heading">
        <h2 id="landing-gallery-heading" className="text-2xl font-semibold">
          Ein Blick in die App
        </h2>
        <div className="mt-4">
          <LandingScreenshotMockups />
        </div>
      </section>

      {/* Upcoming-events teaser (app/page.tsx supplies the public-cache-backed data). */}
      <LandingEventTeaser events={upcomingEvents} />

      {/* DACH community info. */}
      <section aria-labelledby="landing-dach-heading">
        <h2 id="landing-dach-heading" className="text-2xl font-semibold">
          Die DACH-Community
        </h2>
        <p className="mt-3 max-w-2xl text-current/70">
          BeybladeX.de vernetzt Blader aus Deutschland, Österreich und der Schweiz: von
          lokalen Club-Treffen bis zu großen Turnieren — mit gemeinsamem Kalender, Karte und
          Rangliste.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {DACH_REGIONS.map(({ code, label }) => (
            <li
              key={code}
              className="rounded-full border border-x-cyan/30 px-3 py-1 text-sm text-current/70"
            >
              {label}
            </li>
          ))}
        </ul>
      </section>

      {/* Closing register CTA. */}
      <section className="flex flex-col items-center gap-4 rounded-xl border border-x-cyan/20 p-8 text-center">
        <BrandMark size={40} />
        <h2 className="text-xl font-semibold">Bereit für dein erstes Turnier?</h2>
        <p className="max-w-md text-current/70">
          Erstelle dein kostenloses Profil und werde Teil der DACH-Beyblade-Community.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className={CTA_PRIMARY_CLASSES}>
            Jetzt registrieren
          </Link>
          <Link href="/login" className={CTA_SECONDARY_CLASSES}>
            Anmelden
          </Link>
        </div>
      </section>
    </main>
  )
}
