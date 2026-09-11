// components/layout/MobileNav.tsx
// Fixed five-slot bottom navigation (Task 13 + RC8 #24): Events, Decks, Sammlung, Profil
// + a "Mehr" menu. The ≤5-slot mobile practice rules out appending Regeln and Rangliste
// as further tabs (issue #24), so the Start tab was folded INTO the "Mehr" menu — the
// sticky Header's brand link remains a 1-tap home path on every viewport, and the menu
// opens one level up with the remaining public surfaces (Startseite, Regeln, Rangliste,
// Clubs, Builds, Suche). Both issue-relevant targets (/rules, /rangliste) are public, so
// the menu is identical for guests and signed-in users. Profil points at the user's own
// profile when logged in, else at /login.
// RC14 #17 — labels are passed in from the root layout's request dictionary (prop-passing
// idiom, same as Session), keeping this a pure client component with no i18n imports.
'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Archive, Calendar, Layers, Lock, Menu, User, type LucideIcon } from 'lucide-react'
import type { Session } from 'next-auth'
import type { Messages } from '@/lib/i18n/server'

// RC8 #20: `auth` marks tabs whose target renders a GuestGate for guests (/decks,
// /collection) — they carry a lock icon when there is no session. The href stays the
// real route: guests land on the explained gate instead of an uncontextualized login.
const TABS: { href: string; labelKey: keyof Messages['nav']; icon: LucideIcon; auth?: boolean }[] = [
  { href: '/events', labelKey: 'events', icon: Calendar },
  { href: '/decks', labelKey: 'decks', icon: Layers, auth: true },
  { href: '/collection', labelKey: 'collection', icon: Archive, auth: true },
]

// Issue #24: public surfaces without a bottom-tab slot of their own. Mirrors the header's
// NAV_LINKS (components/layout/Header.tsx); /decks and /collection keep their tabs above.
const MORE_LINKS: { href: string; labelKey: keyof Messages['nav'] }[] = [
  { href: '/', labelKey: 'home' },
  { href: '/rules', labelKey: 'rules' },
  { href: '/rangliste', labelKey: 'leaderboard' },
  { href: '/clubs', labelKey: 'clubs' },
  { href: '/builds', labelKey: 'builds' },
  { href: '/search', labelKey: 'search' },
] as const

export function MobileNav({ session, t }: { session: Session | null; t: Messages }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const profileHref = session?.user?.name
    ? `/profile/${encodeURIComponent(session.user.name)}`
    : '/login'
  const tabs = [
    ...TABS.map((t2) => ({ ...t2, label: t.nav[t2.labelKey], locked: Boolean(t2.auth) && !session })),
    { href: profileHref, label: t.nav.profile, icon: User, locked: false },
  ]

  useEffect(() => {
    if (!moreOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const moreActive = MORE_LINKS.some(({ href }) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href),
  )
  const itemCls = (active: boolean) =>
    `flex w-full flex-col items-center gap-0.5 px-1 py-2 text-xs font-medium transition-colors ${
      active ? 'text-x-cyan-text dark:text-x-cyan' : 'text-current/60 hover:text-current'
    }`

  return (
    <nav
      aria-label={t.nav.main}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-x-cyan/20 bg-base-light/90 backdrop-blur dark:bg-base-dark/90 md:hidden"
    >
      {tabs.map(({ href, label, icon: Icon, locked }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            {...(locked ? { 'aria-label': `${label} (${t.nav.loginRequired})` } : {})}
            className={itemCls(active)}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="inline-flex items-center gap-0.5">
              {label}
              {locked && <Lock size={10} aria-hidden="true" />}
            </span>
          </Link>
        )
      })}
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setMoreOpen((v) => !v)}
          className={itemCls(moreActive)}
        >
          <Menu size={20} aria-hidden="true" />
          {t.nav.more}
        </button>
        {moreOpen && (
          <div
            role="menu"
            aria-label={t.nav.morePages}
            className="absolute inset-x-2 bottom-full mb-2 rounded-xl border border-x-cyan/20 bg-white p-2 shadow-xl dark:bg-base-dark-alt"
          >
            {MORE_LINKS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                className="block rounded-md px-3 py-2 text-sm transition-colors hover:bg-current/5"
              >
                {t.nav[labelKey]}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
