// components/teams/TeamCreateForm.tsx (RC15, issue #12)
// "Neues Team" form on /teams: name + optional club affiliation (the caller must be an ACTIVE
// member of the chosen club — the API enforces it; the select only lists clubs they belong
// to). On success the creator lands on the new team's page (they are its captain).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TEAM_NAME_MAX } from '@/lib/teams'

export interface TeamClubOption {
  id: string
  name: string
}

export function TeamCreateForm({ clubs = [] }: { clubs?: TeamClubOption[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [clubId, setClubId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clubId: clubId || null }),
    })
    setPending(false)
    if (res.ok) {
      const body = (await res.json()) as { slug: string }
      router.push(`/teams/${body.slug}`)
      router.refresh()
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'unknown')
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="Team-Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={TEAM_NAME_MAX} required placeholder="z. B. Drachen-Wirbel" />
      </FormField>
      {clubs.length > 0 && (
        <FormField label="Club-Zugehörigkeit (optional)">
          <Select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Kein Club</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error === 'invalid_name'
            ? 'Der Team-Name muss 2–40 Zeichen lang sein.'
            : error === 'forbidden'
              ? 'Nur Mitglieder des gewählten Clubs dürfen eine Anbindung angeben.'
              : 'Das hat leider nicht geklappt. Bitte versuche es erneut.'}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Erstelle…' : 'Team erstellen'}
      </Button>
    </form>
  )
}
