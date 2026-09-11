// components/auth/LoginForm.tsx
// Client half of the /login page (RC14-Nachzügler #130): the page itself is a server component
// that resolves the request dictionary and passes the translated strings down (prop-passing
// idiom). Read ?callbackUrl= straight from the URL (no useSearchParams(), so no Suspense
// boundary is needed around this form) — RC8 issue #20: guests coming from an explained
// GuestGate on /decks or /collection return to where they wanted to go.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { sanitizeCallbackUrl } from '@/lib/callbackUrl'
import type { Messages } from '@/lib/i18n/server'

type LoginStrings = Messages['auth']['login']

function readCallbackUrl(): string | null {
  if (typeof window === 'undefined') return null
  return sanitizeCallbackUrl(new URLSearchParams(window.location.search).get('callbackUrl'))
}

export function LoginForm({ t }: { t: LoginStrings }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpToken, setTotpToken] = useState('')
  const [showTotp, setShowTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [callbackUrl] = useState(readCallbackUrl)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const res = await signIn('credentials', {
      username,
      password,
      totpToken: totpToken || undefined,
      redirect: false,
    })
    setPending(false)
    if (res?.error) {
      // If the account has TOTP enabled, authorize() returns null without a token — reveal the
      // 2FA step and let the user resubmit with totpToken in the SAME sign-in call.
      setShowTotp(true)
      setError(t.error)
      return
    }
    router.push(callbackUrl ?? '/')
  }

  const inputCls =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-light px-4 dark:bg-base-dark">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-lg dark:bg-base-dark-alt">
        <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">{t.heading}</h1>
        {callbackUrl && (
          <p className="rounded-md bg-x-cyan/10 px-3 py-2 text-sm text-current/80">
            {t.gateNotice}
          </p>
        )}
        <label className="block text-sm">
          {t.username}
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
        </label>
        <label className="block text-sm">
          {t.password}
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {showTotp && (
          <label className="block text-sm">
            {t.totp}
            <input
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={totpToken}
              onChange={(e) => setTotpToken(e.target.value)}
              placeholder="123456"
            />
          </label>
        )}
        {error && <p className="text-sm text-type-attack">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-x-cyan px-4 py-2 font-medium text-base-dark disabled:opacity-50"
        >
          {pending ? '…' : t.submit}
        </button>
      </form>
    </main>
  )
}
