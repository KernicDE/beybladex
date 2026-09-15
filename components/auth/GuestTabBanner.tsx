// components/auth/GuestTabBanner.tsx (issue #197)
// Compact sibling of GuestGate for use INSIDE a tab panel whose other tabs stay open to guests
// (Builds' "Meine Builds", Sammlung's "Mein Inventar") — GuestGate itself replaces the whole
// page, which would also hide the public/catalog tabs that guests are allowed to browse.
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { GUEST_GATE_DEFAULT_LABELS, type GuestGateLabels } from '@/components/auth/GuestGate'

export interface GuestTabBannerProps {
  title: string
  description: string
  /** Where the user wanted to go — forwarded as ?callbackUrl= on the login CTA. */
  callbackUrl: string
  labels?: GuestGateLabels
}

export function GuestTabBanner({ title, description, callbackUrl, labels = GUEST_GATE_DEFAULT_LABELS }: GuestTabBannerProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-current/10 bg-current/[0.03] p-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-x-cyan/15 text-x-cyan-text dark:text-x-cyan">
        <Lock size={18} aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-current/70">{description}</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
        >
          {labels.signIn}
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          {labels.register}
        </Link>
      </div>
    </div>
  )
}
