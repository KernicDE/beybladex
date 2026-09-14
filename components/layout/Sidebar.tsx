// components/layout/Sidebar.tsx (#157 — Nutzer-Feedback: "Verschiebung des Menüs auf die
// Seite", revidiert die im Issue #157 zunächst dokumentierte "Top-Nav statt Sidebar"-
// Entscheidung. Desktop-only (siehe `hidden lg:flex` — dieselbe Schwelle, ab der Header.tsx'
// alte Top-Nav vorher sichtbar wurde); Mobile bleibt unverändert bei MobileNav.tsx' Bottom-Tabs.
// Interaktionsmuster (Einklappen auf Icon-Breite, Nav-Labels ausblenden) folgt dem verworfenen,
// aber "funktional weit ausgereiften" Sidebar-Konzept aus
// ~/Downloads/beybladex-design-konzepte/5-green-tech-dashboard.html — nur mit der X-Arena-
// Formsprache (Blade-Clip-Path, Rot/Blau) statt dessen eigener Optik.
//
// "Reduktion aufs Wesentliche" (Ursprüngliche Anforderung in #157: "was selten gebraucht wird,
// muss nicht immer sichtbar sein — Sprache oder Farbschema ändert man nicht dauernd"): Sprache
// (LanguageSwitcher) und Farbschema (ThemeToggle) sind beide bereits selbst einzeilige
// Icon-Buttons mit Hover/Fokus-Dropdown (ThemeToggle wurde dafür in #157 an LanguageSwitcher
// angeglichen) — hier im Footer platziert, nicht in der Nav-Liste, wo sie mit den tatsächlich
// oft gebrauchten Seiten konkurrieren würden.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  Archive,
  BookOpen,
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Lock,
  LogIn,
  LogOut,
  Package,
  Search,
  Shield,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from 'next-auth'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { ExpandIconLink } from '@/components/ui/ExpandIconLink'
import { BrandMark } from '@/components/brand/BrandMark'
import type { Messages } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/locales'

const NAV_LINKS: { href: string; labelKey: keyof Messages['nav']; icon: LucideIcon; auth?: boolean }[] = [
  { href: '/events', labelKey: 'events', icon: Calendar },
  { href: '/decks', labelKey: 'decks', icon: Layers, auth: true },
  { href: '/builds', labelKey: 'builds', icon: Package },
  { href: '/collection', labelKey: 'collection', icon: Archive, auth: true },
  { href: '/clubs', labelKey: 'clubs', icon: Users },
  { href: '/teams', labelKey: 'teams', icon: Shield, auth: true },
  { href: '/rules', labelKey: 'rules', icon: BookOpen },
  { href: '/rangliste', labelKey: 'leaderboard', icon: TrendingUp },
] as const

const COLLAPSE_KEY = 'beybladex-sidebar-collapsed'

export function Sidebar({
  session,
  avatarImageId,
  unreadNotifications,
  locale,
  t,
}: {
  session: Session | null
  avatarImageId: string | null
  unreadNotifications: number
  locale: Locale
  t: Messages
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-x-cyan/20 bg-base-light py-4 transition-[width] duration-200 dark:bg-base-dark lg:flex ${
        collapsed ? 'w-[72px] px-2' : 'w-56 px-3'
      }`}
    >
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-1`}>
        <Link href="/" aria-label="BeybladeX.de" className="flex items-center gap-2 text-x-cyan-text dark:text-x-cyan">
          <BrandMark size={26} />
          {!collapsed && <span className="text-lg font-bold tracking-tight">BeybladeX.de</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Leiste einklappen"
            title="Leiste einklappen"
            className="rounded-md p-1 text-current/60 transition-colors hover:bg-current/5 hover:text-current"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Leiste ausklappen"
          title="Leiste ausklappen"
          className="mx-auto mt-2 rounded-md p-1.5 text-current/60 transition-colors hover:bg-current/5 hover:text-current"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      <nav aria-label={t.nav.main} className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV_LINKS.map(({ href, labelKey, icon: Icon, auth }) => {
          const label = t.nav[labelKey]
          const locked = Boolean(auth) && !session
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              {...(locked ? { 'aria-label': `${label} (${t.nav.loginRequired})` } : {})}
              title={collapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
              // #157 — dieselbe Blade-Formsprache + Rot(aktiv)/Blau(Hover) wie Header/Button.
              className={`flex items-center gap-3 rounded-md [clip-path:polygon(6px_0,100%_0,calc(100%_-_6px)_100%,0_100%)] px-2.5 py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${
                active
                  ? 'bg-x-cyan text-white'
                  : 'text-current/80 hover:bg-x-blue hover:text-white'
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {!collapsed && (
                <span className="inline-flex min-w-0 flex-1 items-center gap-1">
                  <span className="truncate">{label}</span>
                  {locked && <Lock size={12} className="shrink-0" aria-hidden="true" />}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className={`mt-auto flex flex-col gap-1 border-t border-current/10 pt-3 ${collapsed ? 'items-center' : ''}`}>
        {collapsed ? (
          <Link href="/search" aria-label={t.common.search} title={t.common.search} className="rounded-md p-1.5 text-current/70 transition-colors hover:bg-current/5 hover:text-current">
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <ExpandIconLink href="/search" icon={Search} label={t.common.search} />
        )}
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
          {session && <NotificationBell unreadCount={unreadNotifications} />}
          <LanguageSwitcher current={locale} authed={Boolean(session)} labels={{ label: t.language.label, de: t.language.de, en: t.language.en }} />
          <ThemeToggle />
        </div>

        {session ? (
          <div className={`mt-2 flex items-center gap-2 rounded-md px-1.5 py-1.5 ${collapsed ? 'justify-center' : ''}`}>
            <Link
              href={`/profile/${encodeURIComponent(session.user?.name ?? '')}`}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 transition-colors hover:bg-current/5 ${collapsed ? 'justify-center' : ''}`}
              title={session.user?.name ?? ''}
            >
              {avatarImageId ? (
                // eslint-disable-next-line @next/next/no-img-element -- fixed 28px chrome avatar, next/image overhead not worth it here (same call already made this trade-off in UserMenu.tsx)
                <img src={`/api/media/${avatarImageId}`} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-x-cyan/20 text-xs font-semibold text-x-cyan-text dark:text-x-cyan">
                  {(session.user?.name ?? '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              {!collapsed && <span className="truncate text-sm font-medium">{session.user?.name}</span>}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={() => signOut()}
                aria-label="Abmelden"
                title="Abmelden"
                className="shrink-0 rounded-md p-1.5 text-current/60 transition-colors hover:bg-current/5 hover:text-current"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : collapsed ? (
          <Link href="/login" aria-label={t.common.login} title={t.common.login} className="mt-2 rounded-md p-1.5 text-current/70 transition-colors hover:bg-current/5 hover:text-current">
            <LogIn className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <Link
            href="/login"
            className="mt-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-current/80 transition-colors hover:bg-current/5 hover:text-current"
          >
            {t.common.login}
          </Link>
        )}
      </div>
    </aside>
  )
}
