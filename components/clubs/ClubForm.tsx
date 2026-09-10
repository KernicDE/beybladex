// components/clubs/ClubForm.tsx
// Club profile form — dual-purpose (Phase 13):
// - CREATE (no `initial`): name + description + websiteUrl/discordUrl + joinPolicy, posts
//   /api/clubs and redirects to the new club's page. The creator becomes owner/admin server-side.
// - EDIT (`initial` given): description + websiteUrl/discordUrl + joinPolicy only (name is
//   immutable via PATCH), patches /api/clubs/[slug]. Rendered for owner/admins only —
//   the route independently enforces the same tier (403).
// URL fields are optional; the "looks like a URL" hint (inputMode/type=url) is client-side
// only — the server enforces an https?-only allowlist (lib/urlValidation.ts) and rejects
// anything else with invalid_club_url.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'
import { CLUB_DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'

export interface ClubFormInitial {
  slug: string
  description: string | null
  websiteUrl: string | null
  discordUrl: string | null
  joinPolicy: string
}

export const JOIN_POLICY_OPTIONS = [
  { value: 'OPEN', label: 'Offen — jede:r kann sofort beitreten' },
  { value: 'APPLICATION', label: 'Mit Bewerbung — Admins genehmigen neue Mitglieder' },
  { value: 'INVITE_ONLY', label: 'Nur mit Einladung — kein selbstständiges Beitreten' },
] as const

export function ClubForm({ initial }: { initial?: ClubFormInitial }) {
  const router = useRouter()
  const editing = initial !== undefined
  const [name, setName] = useState('')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? '')
  const [discordUrl, setDiscordUrl] = useState(initial?.discordUrl ?? '')
  const [joinPolicy, setJoinPolicy] = useState(initial?.joinPolicy ?? 'OPEN')
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const payload = {
      description: description.trim() || null,
      websiteUrl: websiteUrl.trim() || null,
      discordUrl: discordUrl.trim() || null,
      joinPolicy,
    }
    const res = editing
      ? await fetch(`/api/clubs/${encodeURIComponent(initial.slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/clubs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), ...payload }),
        })
    setPending(false)
    if (res.ok) {
      if (editing) {
        setSaved(true)
        router.refresh()
      } else {
        const body = await res.json()
        router.push(`/clubs/${body.slug}`)
        router.refresh()
      }
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!editing && (
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </FormField>
      )}
      <FormField label="Beschreibung (optional, Markdown)">
        <MarkdownEditor value={description} onChange={setDescription} rows={4} maxLength={CLUB_DESCRIPTION_MAX} />
      </FormField>
      <FormField label="Website (optional)">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          maxLength={200}
        />
      </FormField>
      <FormField label="Discord-Einladung (optional)">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://discord.gg/…"
          value={discordUrl}
          onChange={(e) => setDiscordUrl(e.target.value)}
          maxLength={200}
        />
      </FormField>
      <FormField label="Beitrittsregel">
        <Select value={joinPolicy} onChange={(e) => setJoinPolicy(e.target.value)}>
          {JOIN_POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-type-balance">
          Gespeichert.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Speichere…' : editing ? 'Änderungen speichern' : 'Club erstellen'}
      </Button>
    </form>
  )
}
