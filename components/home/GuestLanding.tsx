// components/home/GuestLanding.tsx (RC13 issue #88)
// The guest home page as a full marketing page: hero, feature overview, screenshot gallery
// (decorative mockups, see LandingScreenshotMockups), upcoming-events teaser, DACH-community
// info, and a closing register CTA. Presentational by design — app/page.tsx fetches the
// teaser events and passes plain props. Pure server components, zero client JS, so the
// guest page stays fully static-renderable per request without any hydration shift.
// Design tokens only (x-cyan / x-cyan-text, Card, existing button idioms) — no parallel
// design language (see also globals.css's USAGE RULE on text-x-cyan vs. text-x-cyan-text).
// RC14 #17 — all copy resolves from the request dictionary passed in by app/page.tsx.
import Link from 'next/link'
import { BookOpen, Calendar, Layers, Package, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { Card } from '@/components/ui/Card'
import { LandingEventTeaser, type LandingTeaserEvent } from '@/components/home/LandingEventTeaser'
import { LandingScreenshotMockups } from '@/components/home/LandingScreenshotMockups'
import type { Messages } from '@/lib/i18n/server'

interface Feature {
  href: string
  icon: LucideIcon
  labelKey: keyof Messages['landing']['features']
}

// #88 — only features that actually exist today; no promises about non-existent functions.
// RC14 #17 — keys into the request dictionary, not literals.
const FEATURES: Feature[] = [
  { href: '/events', icon: Calendar, labelKey: 'events' },
  { href: '/clubs', icon: Users, labelKey: 'clubs' },
  { href: '/decks', icon: Layers, labelKey: 'decks' },
  { href: '/collection', icon: Package, labelKey: 'collection' },
  { href: '/rangliste', icon: TrendingUp, labelKey: 'leaderboard' },
  { href: '/rules', icon: BookOpen, labelKey: 'rules' },
]

const CTA_PRIMARY_CLASSES =
  'rounded-md bg-x-cyan px-6 py-3 font-medium text-base-dark transition-colors hover:bg-x-cyan/85'
const CTA_SECONDARY_CLASSES =
  'rounded-md border border-current/30 px-6 py-3 font-medium transition-colors hover:bg-current/5'

const DACH_REGION_CODES = ['DE', 'AT', 'CH'] as const

export function GuestLanding({ upcomingEvents, t }: { upcomingEvents: LandingTeaserEvent[]; t: Messages }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 p-4 sm:p-6">
      {/* Hero — the register CTA stays the page's primary action. */}
      <section className="flex flex-col items-center gap-5 pt-6 text-center">
        <BrandMark size={64} />
        <h1 className="text-4xl font-bold tracking-tight text-x-cyan-text dark:text-x-cyan">
          BeybladeX.de
        </h1>
        <p className="text-lg font-medium">
          {t.landing.heroTagline}
        </p>
        <p className="max-w-xl text-current/70">
          {t.landing.heroBody}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className={CTA_PRIMARY_CLASSES}>
            {t.common.register}
          </Link>
          <Link href="/login" className={CTA_SECONDARY_CLASSES}>
            {t.common.login}
          </Link>
        </div>
      </section>

      {/* Feature overview — each card deep-links into the real feature. */}
      <section aria-labelledby="landing-features-heading">
        <h2 id="landing-features-heading" className="text-2xl font-semibold">
          {t.landing.featuresHeading}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ href, icon: Icon, labelKey }) => (
            <Link key={href} href={href} className="block transition-opacity hover:opacity-80">
              <Card className="h-full">
                <Icon size={24} aria-hidden="true" className="text-x-cyan-text dark:text-x-cyan" />
                <h3 className="mt-3 font-semibold">{t.landing.features[labelKey].title}</h3>
                <p className="mt-1 text-sm text-current/60">{t.landing.features[labelKey].description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Screenshot gallery — decorative mockup frames until real assets exist (#88). */}
      <section aria-labelledby="landing-gallery-heading">
        <h2 id="landing-gallery-heading" className="text-2xl font-semibold">
          {t.landing.galleryHeading}
        </h2>
        <div className="mt-4">
          <LandingScreenshotMockups />
        </div>
      </section>

      {/* Upcoming-events teaser (app/page.tsx supplies the public-cache-backed data). */}
      <LandingEventTeaser events={upcomingEvents} t={t} />

      {/* DACH community info. */}
      <section aria-labelledby="landing-dach-heading">
        <h2 id="landing-dach-heading" className="text-2xl font-semibold">
          {t.landing.dachHeading}
        </h2>
        <p className="mt-3 max-w-2xl text-current/70">
          {t.landing.dachBody}
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {DACH_REGION_CODES.map((code) => (
            <li
              key={code}
              className="rounded-full border border-x-cyan/30 px-3 py-1 text-sm text-current/70"
            >
              {t.regions[code]}
            </li>
          ))}
        </ul>
      </section>

      {/* Closing register CTA. */}
      <section className="flex flex-col items-center gap-4 rounded-xl border border-x-cyan/20 p-8 text-center">
        <BrandMark size={40} />
        <h2 className="text-xl font-semibold">{t.landing.ctaHeading}</h2>
        <p className="max-w-md text-current/70">
          {t.landing.ctaBody}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className={CTA_PRIMARY_CLASSES}>
            {t.common.register}
          </Link>
          <Link href="/login" className={CTA_SECONDARY_CLASSES}>
            {t.common.login}
          </Link>
        </div>
      </section>
    </main>
  )
}
