'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
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
      setSuccess('Konto erstellt — wartet auf die Einwilligung deiner Eltern. Du kannst dich erst danach anmelden.')
    } else {
      router.push('/login')
    }
  }

  const inputCls =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-light px-4 dark:bg-base-dark">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-lg dark:bg-base-dark-alt">
        <h1 className="text-2xl font-semibold text-x-cyan">Registrieren</h1>
        <label className="block text-sm">
          Benutzername
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={20} />
        </label>
        <label className="block text-sm">
          Passwort
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} />
        </label>
        <label className="block text-sm">
          E-Mail (optional)
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          Geburtsdatum
          <input className={inputCls} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
        </label>
        {isMinor && (
          <label className="block text-sm">
            E-Mail der Eltern (Einwilligung erforderlich)
            <input className={inputCls} type="email" value={parentalConsentEmail} onChange={(e) => setParentalConsentEmail(e.target.value)} required />
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={privacyPolicyAccepted} onChange={(e) => setPrivacyPolicyAccepted(e.target.checked)} required className="mt-1" />
          <span>Ich habe die Datenschutzerklärung gelesen und akzeptiere sie.</span>
        </label>
        {error && <p className="text-sm text-type-attack">{error}</p>}
        {success && <p className="text-sm text-neon-green">{success}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-x-cyan px-4 py-2 font-medium text-base-dark disabled:opacity-50"
        >
          {pending ? '…' : 'Registrieren'}
        </button>
      </form>
    </main>
  )
}
