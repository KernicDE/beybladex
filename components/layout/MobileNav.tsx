// components/layout/MobileNav.tsx
// Fixed five-tab bottom navigation (Task 13): Start, Events, Decks, Sammlung, Profil —
// the mobile-first primary surfaces. Clubs/Rules/Settings live one level deeper,
// reachable from Start or the avatar menu (standard bottom-nav practice of ≤5
// top-level destinations). Profil points at the user's own profile when logged in,
// else at /login.
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Archive, Calendar, Home, Layers, User, type LucideIcon } from 'lucide-react'
import type { Session } from 'next-auth'

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Start', icon: Home },
  { href: '/events', label: 'Events', icon: Calendar },
  { href: '/decks', label: 'Decks', icon: Layers },
  { href: '/collection', label: 'Sammlung', icon: Archive },
]

export function MobileNav({ session }: { session: Session | null }) {
  const pathname = usePathname()
  const profileHref = session?.user?.name
    ? `/profile/${encodeURIComponent(session.user.name)}`
    : '/login'
  const tabs = [...TABS, { href: profileHref, label: 'Profil', icon: User }]

  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-x-cyan/20 bg-base-light/90 backdrop-blur dark:bg-base-dark/90 md:hidden"
    >
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 px-1 py-2 text-xs font-medium transition-colors ${
              active
                ? 'text-x-cyan-text dark:text-x-cyan'
                : 'text-current/60 hover:text-current'
            }`}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
