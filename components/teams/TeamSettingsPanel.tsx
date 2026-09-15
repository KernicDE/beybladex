// components/teams/TeamSettingsPanel.tsx (RC15, issue #12; description+logo added #198)
// Captain-only settings on /teams/[slug]: rename (the slug stays stable so shared links keep
// working), description, crest/logo (TeamLogoUpload), and disband. Disbanding is refused by
// the API while the team is registered in a started, unfinished tournament (409 team_competing).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { TEAM_NAME_MAX } from '@/lib/teams'
import { TeamLogoUpload } from '@/components/teams/TeamLogoUpload'

const DESCRIPTION_MAX = 1000

export function TeamSettingsPanel({
  slug,
  name,
  description,
  logoImageId,
}: {
  slug: string
  name: string
  description: string | null
  logoImageId: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(name)
  const [descValue, setDescValue] = useState(description ?? '')
  const [descPending, setDescPending] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDisband, setConfirmDisband] = useState(false)

  async function rename(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch(`/api/teams/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: value }),
    })
    setPending(false)
    if (res.ok) router.refresh()
    else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'unknown')
  }

  async function saveDescription(e: React.FormEvent) {
    e.preventDefault()
    setDescPending(true)
    setError(null)
    const res = await fetch(`/api/teams/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descValue }),
    })
    setDescPending(false)
    if (res.ok) router.refresh()
    else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'unknown')
  }

  async function disband() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/teams/${slug}`, { method: 'DELETE' })
    setPending(false)
    if (res.ok) {
      router.push('/teams')
      router.refresh()
    } else {
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'unknown')
    }
  }

  return (
    <section aria-labelledby="team-settings-heading" className="space-y-3">
      <h2 id="team-settings-heading" className="text-lg font-semibold">
        Einstellungen
      </h2>
      <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={TEAM_NAME_MAX} aria-label="Team-Name" />
        <Button type="submit" variant="secondary" disabled={pending || value.trim() === name}>
          Umbenennen
        </Button>
      </form>

      <TeamLogoUpload slug={slug} name={name} logoImageId={logoImageId} />

      <form onSubmit={saveDescription} className="space-y-2">
        <label htmlFor="team-description" className="block text-sm font-medium">Beschreibung</label>
        <Textarea
          id="team-description"
          value={descValue}
          onChange={(e) => setDescValue(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          placeholder="Erzähl etwas über euer Team…"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={descPending || descValue === (description ?? '')}>
            Speichern
          </Button>
          <span className="text-xs text-current/50">{descValue.length}/{DESCRIPTION_MAX}</span>
        </div>
      </form>

      <div className="space-y-2 rounded-md border border-type-attack/30 p-3">
        <p className="text-sm font-medium">Team auflösen</p>
        {confirmDisband ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-current/60">Wirklich auflösen? Alle Mitgliedschaften und Anmeldungen gehen verloren.</p>
            <Button variant="secondary" disabled={pending} onClick={disband}>
              Ja, auflösen
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmDisband(false)}>
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmDisband(true)}>
            Team auflösen…
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error === 'team_competing'
            ? 'Das Team kämpft gerade in einem laufenden Turnier mit — auflösen ist erst nach dem Event möglich.'
            : error === 'invalid_name'
              ? 'Der Team-Name muss 2–40 Zeichen lang sein.'
              : 'Das hat leider nicht geklappt. Bitte versuche es erneut.'}
        </p>
      )}
    </section>
  )
}
