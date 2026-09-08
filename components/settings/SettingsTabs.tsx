'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/settings/profile', label: 'Profil' },
  { href: '/settings/privacy', label: 'Privatsphäre' },
  { href: '/settings/security', label: 'Sicherheit' },
  { href: '/settings/notifications', label: 'Benachrichtigungen' },
  { href: '/settings/account', label: 'Konto' },
] as const

export function SettingsTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="Einstellungen" className="mt-4 flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-x-cyan ${
              active
                ? 'bg-x-cyan text-base-dark'
                : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
