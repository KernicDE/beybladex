'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

export function AccountPanel({ username }: { username: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [totpToken, setTotpToken] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function onDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!window.confirm(`Konto „${username}“ wirklich unwiderruflich löschen?`)) return
    setPending(true)
    setMessage(null)
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(password ? { password } : {}),
        ...(totpToken ? { totpToken } : {}),
      }),
    })
    setPending(false)
    if (res.ok) {
      await signOut({ redirect: false })
      router.push('/')
      return
    }
    const body = await res.json().catch(() => null)
    const text =
      body?.error === 'invalid_credentials'
        ? 'Bestätigung fehlgeschlagen — Passwort oder Code war falsch.'
        : `Löschen fehlgeschlagen${body?.error ? ` (${body.error})` : ''}.`
    setMessage({ ok: false, text })
  }

  return (
    <form onSubmit={onDelete} className="space-y-3" aria-label="Konto löschen">
      <label className="block text-sm">
        Passwort zur Bestätigung
        <input
          className={inputCls}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={!!totpToken}
        />
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        …oder, falls 2FA aktiv ist, stattdessen ein aktueller TOTP-Code:
      </p>
      <label className="block text-sm">
        TOTP-Code
        <input
          className={inputCls}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={totpToken}
          onChange={(e) => setTotpToken(e.target.value)}
          disabled={!!password}
        />
      </label>
      {message && <p role="alert" className="text-sm text-type-attack">{message.text}</p>}
      <button
        type="submit"
        disabled={pending || (!password && !totpToken)}
        className="rounded-md bg-type-attack px-4 py-2 font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-x-cyan"
      >
        {pending ? 'Lösche…' : 'Konto endgültig löschen'}
      </button>
    </form>
  )
}
