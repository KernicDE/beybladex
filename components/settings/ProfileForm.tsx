'use client'

import { useState } from 'react'
import { FormField } from '@/components/ui/FormField'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { BIO_MAX } from '@/lib/markdownFieldCaps'
import type { Messages } from '@/lib/i18n/server'

// Pick<> keeps the prop surface minimal: the form renders before the dictionary exists in no
// scenario, but it never needs nav/landing strings.
type ProfileStrings = Pick<Messages, 'settings' | 'common' | 'language'>

type ProfileValues = {
  displayName: string
  bio: string
  city: string
  postalCode: string
  state: string
  country: string
  discordTag: string
  birthDate: string
  language: string
}

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

export function ProfileForm({ initial, isMinor, t }: { initial: ProfileValues; isMinor: boolean; t: ProfileStrings }) {
  const tProfile = t.settings.profile
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
        // RC14 #17 — interface language; validated against SUPPORTED_LOCALES in the route.
        language: values.language || null,
      }),
    })
    setPending(false)
    if (res.ok) {
      setMessage({ ok: true, text: tProfile.saved })
    } else {
      const body = await res.json().catch(() => null)
      setMessage({ ok: false, text: `${tProfile.saveFailed}${body?.error ? ` (${body.error})` : ''}.` })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        {tProfile.displayName}
        <input className={inputCls} value={values.displayName} onChange={set('displayName')} maxLength={50} />
      </label>
      <FormField label={tProfile.bio}>
        <MarkdownEditor
          value={values.bio}
          onChange={(bio) => setValues((v) => ({ ...v, bio }))}
          rows={4}
          maxLength={BIO_MAX}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          {tProfile.city}
          <input className={inputCls} value={values.city} onChange={set('city')} maxLength={100} />
        </label>
        <label className="block text-sm">
          {tProfile.postalCode}
          <input className={inputCls} value={values.postalCode} onChange={set('postalCode')} maxLength={10} inputMode="numeric" />
        </label>
        <label className="block text-sm">
          {tProfile.state}
          <input className={inputCls} value={values.state} onChange={set('state')} maxLength={100} />
        </label>
        <label className="block text-sm">
          {tProfile.country}
          <select className={inputCls} value={values.country} onChange={set('country')}>
            <option value="DE">{tProfile.countryDE}</option>
            <option value="AT">{tProfile.countryAT}</option>
            <option value="CH">{tProfile.countryCH}</option>
          </select>
        </label>
      </div>
      {/* RC14 #17 — the profile language setting: drives the interface language on every
          signed-in request (lib/i18n/server.ts). */}
      <label className="block text-sm">
        {tProfile.language}
        <select className={inputCls} value={values.language} onChange={set('language')}>
          <option value="de">{t.language.de}</option>
          <option value="en">{t.language.en}</option>
        </select>
        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
          {tProfile.languageHint}
        </span>
      </label>
      <label className="block text-sm">
        {tProfile.discordTag}
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
            {tProfile.discordMinorNote}
          </span>
        )}
      </label>
      <label className="block text-sm">
        {tProfile.birthDate}
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
        {pending ? t.common.saving : t.common.save}
      </button>
    </form>
  )
}
