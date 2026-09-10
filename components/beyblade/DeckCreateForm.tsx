// components/beyblade/DeckCreateForm.tsx
// Creates an empty deck (POST /api/decks) and navigates straight into the deck builder.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'

export function DeckCreateForm() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    })
    if (!res.ok) {
      setBusy(false)
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    const { id } = (await res.json()) as { id: string }
    router.push(`/decks/item/${id}`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <FormField label="Deckname" className="min-w-56 flex-1">
        <Input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="z. B. Turnier-Deck September" />
      </FormField>
      <Button type="submit" disabled={busy}>Deck erstellen</Button>
      {error && <p role="alert" className="w-full text-sm text-type-attack">{error}</p>}
    </form>
  )
}
