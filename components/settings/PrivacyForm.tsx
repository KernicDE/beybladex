'use client'

import { useState } from 'react'

type Visibility = 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE'
type PrivacyValues = Record<'profileVisibility' | 'locationVisibility' | 'collectionVisibility' | 'decksVisibility' | 'ageVisibility', Visibility>

const FIELDS: { key: keyof PrivacyValues; label: string; description: string }[] = [
  { key: 'profileVisibility', label: 'Profil', description: 'Anzeigename, Über-mich-Text und Discord-Tag' },
  { key: 'locationVisibility', label: 'Wohnort', description: 'Stadt und Region' },
  { key: 'collectionVisibility', label: 'Sammlung', description: 'Deine gesammelten Teile und Beys' },
  { key: 'decksVisibility', label: 'Decks', description: 'Deine Decks und Builds' },
  { key: 'ageVisibility', label: 'Alter', description: 'Dein Geburtsdatum / dein Alter' },
]

const OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'PUBLIC', label: 'Öffentlich' },
  { value: 'FRIENDS_ONLY', label: 'Nur Freund:innen' },
  { value: 'PRIVATE', label: 'Privat' },
]

const selectCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

export function PrivacyForm({ initial, isMinor }: { initial: PrivacyValues; isMinor: boolean }) {
  const [values, setValues] = useState<PrivacyValues>(initial)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setMessage(null)
    const res = await fetch('/api/profile/privacy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    setPending(false)
    if (res.ok) {
      setMessage({ ok: true, text: 'Privatsphäre-Einstellungen gespeichert.' })
    } else {
      const body = await res.json().catch(() => null)
      setMessage({ ok: false, text: `Speichern fehlgeschlagen${body?.error ? ` (${body.error})` : ''}.` })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {FIELDS.map(({ key, label, description }) => {
        const locked = isMinor && key === 'locationVisibility'
        return (
          <label key={key} className="block text-sm">
            <span className="font-medium">{label}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
            <select
              className={selectCls}
              value={values[key]}
              disabled={locked}
              aria-describedby={locked ? `${key}-locked-note` : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value as Visibility }))}
            >
              {OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {locked && (
              <span id={`${key}-locked-note`} className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                Für Minderjährige ist der Wohnort immer nur für dich selbst sichtbar — diese
                Grenze kann nicht geändert werden.
              </span>
            )}
          </label>
        )
      })}
      {message && (
        <p role="status" className={message.ok ? 'text-sm text-type-balance' : 'text-sm text-type-attack'}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-x-cyan px-4 py-2 font-medium text-base-dark disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-x-cyan"
      >
        {pending ? 'Speichere…' : 'Speichern'}
      </button>
    </form>
  )
}
