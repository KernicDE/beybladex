// components/auth/GuestGate.tsx
// Explained intermediate state for auth-gated pages (RC8 issue #20): clicking
// "Decks"/"Sammlung" as a guest used to silently redirect('/login') with no context.
// Instead the page now renders this gate in place — what the feature is, why login is
// required, and CTAs that carry a callbackUrl so the login page can return the user
// to where they wanted to go. Server-safe (no hooks, no client JS needed).
// RC14-Nachzügler #130 — CTA copy comes from the request dictionary via the optional
// `labels` prop (German defaults keep not-yet-translated call sites working).
import Link from 'next/link'
import { Lock } from 'lucide-react'

export interface GuestGateLabels {
  signIn: string
  register: string
  footnote: string
}

const DEFAULT_LABELS: GuestGateLabels = {
  signIn: 'Anmelden',
  register: 'Registrieren',
  footnote: 'Nach dem Anmelden wirst du automatisch zu dieser Seite zurückgeleitet.',
}

export interface GuestGateProps {
  title: string
  description: string
  /** Where the user wanted to go — forwarded as ?callbackUrl= on the login CTA. */
  callbackUrl: string
  /** Translated CTA copy (t.guestGate.*). Defaults keep legacy German call sites working. */
  labels?: GuestGateLabels
}

export function GuestGate({ title, description, callbackUrl, labels = DEFAULT_LABELS }: GuestGateProps) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 p-6 pt-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-x-cyan/15 text-x-cyan-text dark:text-x-cyan">
        <Lock size={22} aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-current/70">{description}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="rounded-md bg-x-cyan px-6 py-3 font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
        >
          {labels.signIn}
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-current/30 px-6 py-3 font-medium transition-colors hover:bg-current/5"
        >
          {labels.register}
        </Link>
      </div>
      <p className="text-sm text-current/50">
        {labels.footnote}
      </p>
    </main>
  )
}
