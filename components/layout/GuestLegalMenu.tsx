// components/layout/GuestLegalMenu.tsx
// Issue #22: mobile guests had no path at all to Impressum/Datenschutz — the Footer
// carrying those links is desktop-only (`md:block`), and the only other place they lived,
// UserMenu, only renders for a signed-in session. This gives every guest (any viewport,
// since it renders in the always-visible sticky Header) a ≤2-click path to the legal pages:
// tap the "Rechtliches" trigger, tap a link. Deliberately kept visible on desktop too
// (redundant with the Footer there) rather than gated to `<md` — one code path, no
// layout-breakpoint bug can silently take guests back to zero.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Scale } from 'lucide-react'
import { LEGAL_LINKS } from '@/components/layout/legalLinks'

export function GuestLegalMenu() {
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
        className="flex h-9 w-9 items-center justify-center rounded-md text-current/80 transition-colors hover:bg-current/5 hover:text-current"
      >
        <Scale size={18} aria-hidden="true" />
        <span className="sr-only">Rechtliches</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Rechtliches"
          className="absolute right-0 mt-2 w-44 rounded-xl border border-x-cyan/20 bg-white p-2 shadow-xl dark:bg-base-dark-alt"
        >
          {LEGAL_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-current/5"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
