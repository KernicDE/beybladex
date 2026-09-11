// components/layout/Header.tsx
// Fixed navigation model (Task 13): brand, primary nav, search entry point,
// notification bell (active since RC10 #26 — unread badge from the root layout's
// server-side count), session-aware user menu (client component — dropdown +
// signOut need client interactivity).
// RC14 #17 — chrome labels come from the request dictionary (the root layout resolves the
// locale in lib/i18n/server.ts and passes the strings down); the LanguageSwitcher next to
// the theme toggle is the guest-facing entry point of the language setting.
import Link from 'next/link'
import { Lock, Search } from 'lucide-react'
import type { Session } from 'next-auth'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { SearchInput } from '@/components/ui/SearchInput'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { UserMenu } from '@/components/layout/UserMenu'
import { GuestLegalMenu } from '@/components/layout/GuestLegalMenu'
import { BrandMark } from '@/components/brand/BrandMark'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import type { Messages } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/locales'

// Primary nav. These routes land in later phases (3–5); linking to them now is
// the binding IA decision — they 404 until their phase ships.
// IA note (binding for Phase 3): /events is the public event LIST; event detail
// lives at /events/[id] (public, guest-visible) while /tournaments/[id] is the
// competitive/operational surface.
// RC8 #20: `auth` marks routes that render a GuestGate for guests (/decks,
// /collection) — they get a lock icon in the nav when there is no session.
// RC14 #17 — labels are dictionary KEYS (resolved per request below), not literals: adding
// a locale never touches this file.
const NAV_LINKS: { href: string; labelKey: keyof Messages['nav']; auth?: boolean }[] = [
  // RC10 #29: the public IA term is "Events" (matching /events and the bottom nav's tab)
  // — one name per route across header and MobileNav.
  { href: '/events', labelKey: 'events' },
  { href: '/decks', labelKey: 'decks', auth: true },
  { href: '/builds', labelKey: 'builds' },
  { href: '/collection', labelKey: 'collection', auth: true },
  { href: '/clubs', labelKey: 'clubs' },
  // RC15 #12 — 3-vs-3 team competition surface (auth-gated page: my teams).
  { href: '/teams', labelKey: 'teams', auth: true },
  { href: '/rules', labelKey: 'rules' },
  // Phase 14 — public Elo leaderboard for the current ACTIVE season.
  { href: '/rangliste', labelKey: 'leaderboard' },
] as const

export function Header({ session, avatarImageId, unreadNotifications, locale, t }: { session: Session | null; avatarImageId: string | null; unreadNotifications?: number; locale: Locale; t: Messages }) {
  const username = session?.user?.name
  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 border-b border-x-cyan/20 bg-base-light/90 px-4 py-3 backdrop-blur dark:bg-base-dark/90 md:px-8">
      <Link
        href="/"
        className="flex items-center gap-2 text-lg font-bold tracking-tight text-x-cyan-text dark:text-x-cyan"
      >
        <BrandMark size={26} />
        BeybladeX.de
      </Link>
      <nav aria-label={t.nav.main} className="hidden items-center gap-1 lg:flex">
        {NAV_LINKS.map(({ href, labelKey, auth }) => {
          const label = t.nav[labelKey]
          const locked = Boolean(auth) && !session
          return (
            <Link
              key={href}
              href={href}
              {...(locked ? { 'aria-label': `${label} (${t.nav.loginRequired})` } : {})}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-current/80 transition-colors hover:bg-current/5 hover:text-current"
            >
              <span className="inline-flex items-center gap-1">
                {label}
                {locked && <Lock size={12} aria-hidden="true" />}
              </span>
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {/* #25: mobile search entry — the full input stays md+ only (header space); below
            md a 1-tap icon link leads to /search, which carries its own SearchInput. */}
        <Link
          href="/search"
          aria-label={t.common.search}
          className="rounded-md p-2 text-current/80 transition-colors hover:bg-current/5 hover:text-current md:hidden"
        >
          <Search size={18} aria-hidden="true" />
        </Link>
        <SearchInput
          className="hidden w-56 md:block"
          placeholder={t.common.searchPlaceholder}
          submitLabel={t.common.search}
        />
        {session && <NotificationBell unreadCount={unreadNotifications ?? 0} />}
        <LanguageSwitcher current={locale} labels={{ label: t.language.label, de: t.language.de, en: t.language.en }} />
        <ThemeToggle />
        {session ? (
          <UserMenu username={username ?? ''} avatarImageId={avatarImageId} />
        ) : (
          <>
            {/* Guests have no other path to the legal pages below `md` — the Footer is
                desktop-only and UserMenu only renders for a session (issue #22). */}
            <GuestLegalMenu />
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-current/80 transition-colors hover:bg-current/5 hover:text-current"
            >
              {t.common.login}
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
