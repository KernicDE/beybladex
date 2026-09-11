// components/layout/MobileNav.tsx
// Fixed five-slot bottom navigation (Task 13 + RC8 #24): Events, Decks, Sammlung, Profil
// + a "Mehr" menu. The ≤5-slot mobile practice rules out appending Regeln and Rangliste
// as further tabs (issue #24), so the Start tab was folded INTO the "Mehr" menu — the
// sticky Header's brand link remains a 1-tap home path on every viewport, and the menu
// opens one level up with the remaining public surfaces (Startseite, Regeln, Rangliste,
// Clubs, Builds, Suche). Both issue-relevant targets (/rules, /rangliste) are public, so
// the menu is identical for guests and signed-in users. Profil points at the user's own
// profile when logged in, else at /login.
'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Archive, Calendar, Layers, Lock, Menu, User, type LucideIcon } from 'lucide-react'
import type { Session } from 'next-auth'

// RC8 #20: `auth` marks tabs whose target renders a GuestGate for guests (/decks,
// /collection) — they carry a lock icon when there is no session. The href stays the
// real route: guests land on the explained gate instead of an uncontextualized login.
const TABS: { href: string; label: string; icon: LucideIcon; auth?: boolean }[] = [
  { href: '/events', label: 'Events', icon: Calendar },
  { href: '/decks', label: 'Decks', icon: Layers, auth: true },
  { href: '/collection', label: 'Sammlung', icon: Archive, auth: true },
]

// Issue #24: public surfaces without a bottom-tab slot of their own. Mirrors the header's
// NAV_LINKS (components/layout/Header.tsx); /decks and /collection keep their tabs above.
const MORE_LINKS = [
  { href: '/', label: 'Startseite' },
  { href: '/rules', label: 'Regeln' },
  { href: '/rangliste', label: 'Rangliste' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/builds', label: 'Builds' },
  { href: '/search', label: 'Suche' },
] as const

export function MobileNav({ session }: { session: Session | null }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const profileHref = session?.user?.name
    ? `/profile/${encodeURIComponent(session.user.name)}`
    : '/login'
  const tabs = [
    ...TABS.map((t) => ({ ...t, locked: Boolean(t.auth) && !session })),
    { href: profileHref, label: 'Profil', icon: User, locked: false },
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
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-x-cyan/20 bg-base-light/90 backdrop-blur dark:bg-base-dark/90 md:hidden"
    >
      {tabs.map(({ href, label, icon: Icon, locked }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            {...(locked ? { 'aria-label': `${label} (Anmeldung erforderlich)` } : {})}
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
          Mehr
        </button>
        {moreOpen && (
          <div
            role="menu"
            aria-label="Weitere Seiten"
            className="absolute inset-x-2 bottom-full mb-2 rounded-xl border border-x-cyan/20 bg-white p-2 shadow-xl dark:bg-base-dark-alt"
          >
            {MORE_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                className="block rounded-md px-3 py-2 text-sm transition-colors hover:bg-current/5"
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
