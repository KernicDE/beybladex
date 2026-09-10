'use client'

import { useState } from 'react'

type NotificationsValues = {
  notifyRadiusKm: number
  notifyRecurring: boolean
  notifyEmail: boolean
  // Phase 18 — separate from notifyEmail (the blanket toggle for the two fields above and club
  // activity): gates push+in-app / email respectively for the three match/arena-lifecycle
  // triggers ("Turnier gestartet", "Gehe zu Arena N", "Dein nächstes Match beginnt").
  notifyMatchLifecycle: boolean
  notifyMatchLifecycleEmail: boolean
}

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50'

export function NotificationsForm({ initial }: { initial: NotificationsValues }) {
  const [values, setValues] = useState<NotificationsValues>(initial)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setMessage(null)
    const res = await fetch('/api/profile/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    setPending(false)
    if (res.ok) {
      setMessage({ ok: true, text: 'Benachrichtigungs-Einstellungen gespeichert.' })
    } else {
      const body = await res.json().catch(() => null)
      setMessage({ ok: false, text: `Speichern fehlgeschlagen${body?.error ? ` (${body.error})` : ''}.` })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        Suchradius (km)
        <input
          className={inputCls}
          type="number"
          min={1}
          max={500}
          step={1}
          value={values.notifyRadiusKm}
          onChange={(e) => setValues((v) => ({ ...v, notifyRadiusKm: Number(e.target.value) }))}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.notifyRecurring}
          onChange={(e) => setValues((v) => ({ ...v, notifyRecurring: e.target.checked }))}
        />
        Auch über wiederkehrende Turniere informieren
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.notifyEmail}
          onChange={(e) => setValues((v) => ({ ...v, notifyEmail: e.target.checked }))}
        />
        Zusätzlich per E-Mail benachrichtigen
      </label>

      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <p className="mb-2 text-sm font-medium">Turnier- und Match-Ablauf</p>
        <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
          „Turnier gestartet“, „Gehe zu Arena N“, „Dein nächstes Match beginnt“ — für Turniere,
          bei denen du angemeldet bist.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.notifyMatchLifecycle}
            onChange={(e) => setValues((v) => ({ ...v, notifyMatchLifecycle: e.target.checked }))}
          />
          Push-Benachrichtigungen (zusätzlich zur Geräte-Freigabe oben nötig)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.notifyMatchLifecycleEmail}
            onChange={(e) => setValues((v) => ({ ...v, notifyMatchLifecycleEmail: e.target.checked }))}
          />
          Zusätzlich per E-Mail
        </label>
      </div>
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
