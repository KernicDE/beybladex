// components/beyblade/PartRequestCTA.tsx
// "Teil fehlt? Anfragen" — the user-facing half of the request-missing-part flow, shown on
// /search when a Teile lookup finds nothing. POSTs to /api/parts/request (any logged-in
// user; guests get a login prompt — the API returns 401 otherwise).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { PART_REQUEST_NOTES_MAX } from '@/lib/markdownFieldCaps'

export function PartRequestCTA({ defaultName = '', loggedIn = true }: { defaultName?: string; loggedIn?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [manufacturerGuess, setManufacturerGuess] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!loggedIn) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/parts/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        manufacturerGuess: manufacturerGuess === '' ? null : manufacturerGuess,
        notes: notes.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    setDone(true)
    router.refresh()
  }

  if (done) {
    return <p className="text-sm text-current/70">Danke! Die Anfrage liegt beim Katalog-Team.</p>
  }
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Teil fehlt? Anfragen
      </Button>
    )
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-dashed border-x-cyan/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Vermuteter Hersteller (optional)">
          <Select value={manufacturerGuess} onChange={(e) => setManufacturerGuess(e.target.value)}>
            <option value="">—</option>
            <option value="TT">Takara Tomy</option>
            <option value="HASBRO">Hasbro</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Notiz (optional, Markdown)">
        <MarkdownEditor value={notes} onChange={setNotes} rows={2} maxLength={PART_REQUEST_NOTES_MAX} placeholder="z. B. erscheint im Set X mit …" />
      </FormField>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Anfrage absenden</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
      </div>
    </form>
  )
}
