// components/layout/UserMenu.tsx
// Session-aware avatar/username dropdown: Profil, Einstellungen, Abmelden — plus the
// three legal links (Impressum/Datenschutz/AGB). The Footer that carries them is
// desktop-only (Task 10), so this menu is the mobile path to the legal pages
// (binding per the plan's "Mobile legal-page access" note — ≤2 clicks on any viewport).
// Phase 21: the trigger renders the viewer's OWN uploaded avatar (avatarImageId, fetched
// by the server-component Header) with the initial-letter fallback — always the viewer's
// own data, no privacy gate, matching the username rendered next to it.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'

const LEGAL_LINKS = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/datenschutz', label: 'Datenschutz' },
  { href: '/agb', label: 'AGB' },
] as const

export function UserMenu({ username, avatarImageId }: { username: string; avatarImageId: string | null }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-x-cyan/20 text-sm font-semibold text-x-cyan-text dark:text-x-cyan"
      >
        {avatarImageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- 32px menu trigger showing the viewer's OWN avatar (always their own data, no privacy gate)
          <img src={`/api/media/${avatarImageId}`} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span aria-hidden="true">{(username[0] ?? '?').toUpperCase()}</span>
        )}
        <span className="sr-only">Kontomenü ({username})</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 rounded-xl border border-x-cyan/20 bg-white p-2 shadow-xl dark:bg-base-dark-alt"
        >
          <p className="px-3 py-1.5 text-sm font-medium">{username}</p>
          <MenuLink href={`/profile/${encodeURIComponent(username)}`} onClick={() => setOpen(false)}>
            Profil
          </MenuLink>
          <MenuLink href="/settings" onClick={() => setOpen(false)}>
            Einstellungen
          </MenuLink>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-current/5"
          >
            Abmelden
          </button>
          {/* Legal links — mobile equivalent of the desktop-only Footer. */}
          <div className="mt-2 border-t border-x-cyan/20 pt-2" role="group" aria-label="Rechtliches">
            {LEGAL_LINKS.map(({ href, label }) => (
              <MenuLink key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </MenuLink>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-current/5"
    >
      {children}
    </Link>
  )
}
