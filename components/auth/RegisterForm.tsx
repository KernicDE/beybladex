// components/auth/RegisterForm.tsx
// Client half of the /register page (RC14-Nachzügler #130): the page itself is a server
// component that resolves the request dictionary and passes the translated strings down
// (prop-passing idiom).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Messages } from '@/lib/i18n/server'

type RegisterStrings = Messages['auth']['register']

export function RegisterForm({ t }: { t: RegisterStrings }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [parentalConsentEmail, setParentalConsentEmail] = useState('')
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const isMinor = birthDate ? new Date().getFullYear() - new Date(birthDate).getFullYear() < 16 : false

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setPending(true)
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        email: email || undefined,
        birthDate,
        privacyPolicyAccepted,
        parentalConsentEmail: isMinor ? parentalConsentEmail : undefined,
      }),
    })
    const data = await res.json()
    setPending(false)
    if (!res.ok) {
      setError(data.error ?? 'registration_failed')
      return
    }
    if (data.status === 'PENDING_PARENTAL_CONSENT') {
      setSuccess(t.consentPending)
    } else {
      router.push('/login')
    }
  }

  const inputCls =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-light px-4 dark:bg-base-dark">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-lg dark:bg-base-dark-alt">
        <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">{t.heading}</h1>
        <label className="block text-sm">
          {t.username}
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={20} />
        </label>
        {/* Phase 19: explain the lowercase-only rule (and the display-name alternative) BEFORE
            the user fails submission — lib/errorCopy.ts's invalid_username copy only showed reactively. */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t.usernameHint}
        </p>
        <label className="block text-sm">
          {t.password}
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} />
        </label>
        <label className="block text-sm">
          {t.emailOptional}
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          {t.birthDate}
          <input className={inputCls} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
        </label>
        {isMinor && (
          <label className="block text-sm">
            {t.parentEmail}
            <input className={inputCls} type="email" value={parentalConsentEmail} onChange={(e) => setParentalConsentEmail(e.target.value)} required />
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={privacyPolicyAccepted} onChange={(e) => setPrivacyPolicyAccepted(e.target.checked)} required className="mt-1" />
          <span>{t.privacyLabel}</span>
        </label>
        {error && <p className="text-sm text-type-attack">{error}</p>}
        {success && <p className="text-sm text-neon-green">{success}</p>}
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
