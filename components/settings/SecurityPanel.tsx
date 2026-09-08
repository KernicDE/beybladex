'use client'

// The interactive half of app/settings/security/page.tsx. Three flows, all against existing
// Task 6 routes + the new /api/totp/disable:
//   1. Register a new passkey      → GET/POST /api/webauthn/register (Redis challenge ceremony)
//   2. Set up TOTP 2FA             → GET /api/totp/setup (QR), POST /api/totp/verify
//   3. Disable TOTP 2FA            → POST /api/totp/disable (password re-confirm, server-verified)
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startRegistration } from '@simplewebauthn/browser'

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'
const buttonCls =
  'rounded-md bg-x-cyan px-4 py-2 font-medium text-base-dark disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-x-cyan'

type TotpSetup = { qrCodeDataUrl: string; otpauthUrl: string }

export function SecurityPanel({ passkeyCount, totpEnabled }: { passkeyCount: number; totpEnabled: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null)
  const [totpToken, setTotpToken] = useState('')
  const [disablePassword, setDisablePassword] = useState('')

  async function registerPasskey() {
    setBusy(true)
    setMessage(null)
    try {
      const optionsRes = await fetch('/api/webauthn/register')
      if (!optionsRes.ok) throw new Error((await optionsRes.json().catch(() => null))?.error ?? 'challenge_failed')
      const { options, nonce } = await optionsRes.json()

      const response = await startRegistration(options)

      const verifyRes = await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, response }),
      })
      if (!verifyRes.ok) throw new Error((await verifyRes.json().catch(() => null))?.error ?? 'verification_failed')
      setMessage({ ok: true, text: 'Passkey registriert.' })
      router.refresh()
    } catch (err) {
      const name = err instanceof DOMException ? err.name : (err as Error)?.name
      setMessage({
        ok: false,
        text: name === 'NotAllowedError' ? 'Registrierung abgebrochen.' : 'Passkey-Registrierung fehlgeschlagen.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function beginTotpSetup() {
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/totp/setup')
    setBusy(false)
    if (!res.ok) {
      setMessage({ ok: false, text: '2FA-Setup fehlgeschlagen (Rate-Limit oder nicht angemeldet).' })
      return
    }
    setTotpSetup(await res.json())
    setTotpToken('')
  }

  async function confirmTotpSetup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/totp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: totpToken }),
    })
    setBusy(false)
    if (res.ok) {
      setTotpSetup(null)
      setMessage({ ok: true, text: 'Zwei-Faktor-Authentifizierung ist jetzt aktiv.' })
      router.refresh()
    } else {
      setMessage({ ok: false, text: 'Code ungültig oder abgelaufen — Setup bitte neu starten.' })
    }
  }

  async function disableTotp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/totp/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: disablePassword }),
    })
    setBusy(false)
    if (res.ok) {
      setDisablePassword('')
      setMessage({ ok: true, text: 'Zwei-Faktor-Authentifizierung wurde deaktiviert.' })
      router.refresh()
    } else {
      const body = await res.json().catch(() => null)
      setMessage({
        ok: false,
        text: body?.error === 'invalid_password' ? 'Passwort falsch.' : 'Deaktivieren fehlgeschlagen.',
      })
    }
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={registerPasskey} disabled={busy} className={buttonCls}>
        {passkeyCount === 0 ? 'Passkey hinzufügen' : 'Weiteren Passkey hinzufügen'}
      </button>

      <div className="space-y-3 border-t border-zinc-300 pt-4 dark:border-zinc-700">
        <h3 className="font-medium">Zwei-Faktor-Authentifizierung (TOTP)</h3>
        {totpEnabled ? (
          <p className="text-sm text-type-balance">2FA ist für dein Konto aktiv.</p>
        ) : totpSetup ? (
          <form onSubmit={confirmTotpSetup} className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the server-generated QR code */}
            <img src={totpSetup.qrCodeDataUrl} alt="QR-Code für die Authenticator-App" className="h-44 w-44" />
            <p className="text-xs break-all text-zinc-500 dark:text-zinc-400">{totpSetup.otpauthUrl}</p>
            <label className="block text-sm">
              Code aus der App
              <input
                className={inputCls}
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy || totpToken.length !== 6} className={buttonCls}>
              2FA aktivieren
            </button>
          </form>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            2FA ist nicht aktiv. Mit einer Authenticator-App schützt du dein Konto zusätzlich.
          </p>
        )}
        {!totpEnabled && !totpSetup && (
          <button type="button" onClick={beginTotpSetup} disabled={busy} className={buttonCls}>
            2FA einrichten
          </button>
        )}
      </div>

      {totpEnabled && (
        <form onSubmit={disableTotp} className="space-y-3 border-t border-zinc-300 pt-4 dark:border-zinc-700" aria-label="2FA deaktivieren">
          <h3 className="font-medium">2FA deaktivieren</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Aus Sicherheitsgründen musst du dazu dein Passwort bestätigen.
          </p>
          <label className="block text-sm">
            Aktuelles Passwort
            <input
              className={inputCls}
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy || !disablePassword} className={buttonCls}>
            2FA deaktivieren
          </button>
        </form>
      )}

      {message && (
        <p role="status" className={message.ok ? 'text-sm text-type-balance' : 'text-sm text-type-attack'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
