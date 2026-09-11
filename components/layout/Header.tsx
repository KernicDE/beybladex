// components/layout/Header.tsx
// Fixed navigation model (Task 13): brand, primary nav, search entry point,
// notification bell placeholder, session-aware user menu (client component —
// dropdown + signOut need client interactivity).
import Link from 'next/link'
import { Bell, Lock, Search } from 'lucide-react'
import type { Session } from 'next-auth'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { SearchInput } from '@/components/ui/SearchInput'
import { UserMenu } from '@/components/layout/UserMenu'
import { GuestLegalMenu } from '@/components/layout/GuestLegalMenu'
import { BrandMark } from '@/components/brand/BrandMark'

// Primary nav. These routes land in later phases (3–5); linking to them now is
// the binding IA decision — they 404 until their phase ships.
// IA note (binding for Phase 3): /events is the public event LIST; event detail
// lives at /events/[id] (public, guest-visible) while /tournaments/[id] is the
// competitive/operational surface.
// RC8 #20: `auth` marks routes that render a GuestGate for guests (/decks,
// /collection) — they get a lock icon in the nav when there is no session.
const NAV_LINKS: { href: string; label: string; auth?: boolean }[] = [
  { href: '/events', label: 'Turniere & Events' },
  { href: '/decks', label: 'Decks', auth: true },
  { href: '/builds', label: 'Builds' },
  { href: '/collection', label: 'Sammlung', auth: true },
  { href: '/clubs', label: 'Clubs' },
  { href: '/rules', label: 'Regeln' },
  // Phase 14 — public Elo leaderboard for the current ACTIVE season.
  { href: '/rangliste', label: 'Rangliste' },
] as const

export function Header({ session, avatarImageId }: { session: Session | null; avatarImageId: string | null }) {
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
      <nav aria-label="Hauptnavigation" className="hidden items-center gap-1 lg:flex">
        {NAV_LINKS.map(({ href, label, auth }) => {
          const locked = Boolean(auth) && !session
          return (
            <Link
              key={href}
              href={href}
              {...(locked ? { 'aria-label': `${label} (Anmeldung erforderlich)` } : {})}
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
          aria-label="Suche"
          className="rounded-md p-2 text-current/80 transition-colors hover:bg-current/5 hover:text-current md:hidden"
        >
          <Search size={18} aria-hidden="true" />
        </Link>
        <SearchInput className="hidden w-56 md:block" />
        {session && (
          <Link
            href="/notifications"
            aria-label="Benachrichtigungen"
            className="relative rounded-md p-2 text-current/80 transition-colors hover:bg-current/5 hover:text-current"
          >
            {/* Unread-count badge lands in Phase 3 with the notification inbox. */}
            <Bell size={18} aria-hidden="true" />
          </Link>
        )}
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
              Anmelden
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
