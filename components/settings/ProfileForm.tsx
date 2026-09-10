'use client'

import { useState } from 'react'
import { FormField } from '@/components/ui/FormField'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { BIO_MAX } from '@/lib/markdownFieldCaps'

type ProfileValues = {
  displayName: string
  bio: string
  city: string
  postalCode: string
  state: string
  country: string
  discordTag: string
  birthDate: string
}

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

export function ProfileForm({ initial, isMinor }: { initial: ProfileValues; isMinor: boolean }) {
  const [values, setValues] = useState<ProfileValues>(initial)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const set = (key: keyof ProfileValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setMessage(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: values.displayName || null,
        bio: values.bio || null,
        city: values.city || null,
        postalCode: values.postalCode || null,
        state: values.state || null,
        country: values.country || null,
        discordTag: values.discordTag || null,
        birthDate: values.birthDate || null,
      }),
    })
    setPending(false)
    if (res.ok) {
      setMessage({ ok: true, text: 'Profil gespeichert.' })
    } else {
      const body = await res.json().catch(() => null)
      setMessage({ ok: false, text: `Speichern fehlgeschlagen${body?.error ? ` (${body.error})` : ''}.` })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        Anzeigename
        <input className={inputCls} value={values.displayName} onChange={set('displayName')} maxLength={50} />
      </label>
      <FormField label="Über mich">
        <MarkdownEditor
          value={values.bio}
          onChange={(bio) => setValues((v) => ({ ...v, bio }))}
          rows={4}
          maxLength={BIO_MAX}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Stadt
          <input className={inputCls} value={values.city} onChange={set('city')} maxLength={100} />
        </label>
        <label className="block text-sm">
          Postleitzahl
          <input className={inputCls} value={values.postalCode} onChange={set('postalCode')} maxLength={10} inputMode="numeric" />
        </label>
        <label className="block text-sm">
          Bundesland / Kanton
          <input className={inputCls} value={values.state} onChange={set('state')} maxLength={100} />
        </label>
        <label className="block text-sm">
          Land
          <select className={inputCls} value={values.country} onChange={set('country')}>
            <option value="DE">Deutschland</option>
            <option value="AT">Österreich</option>
            <option value="CH">Schweiz</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Discord-Tag
        <input
          className={inputCls}
          value={values.discordTag}
          onChange={set('discordTag')}
          maxLength={100}
          disabled={isMinor}
          aria-describedby={isMinor ? 'discord-minor-note' : undefined}
        />
        {isMinor && (
          <span id="discord-minor-note" className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            Für Minderjährige ist der Discord-Tag ausgeschaltet — andere Nutzer:innen können ihn
            aus Jugendschutzgründen nicht sehen, egal was hier eingetragen ist.
          </span>
        )}
      </label>
      <label className="block text-sm">
        Geburtsdatum
        <input className={inputCls} type="date" value={values.birthDate} onChange={set('birthDate')} />
      </label>
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
