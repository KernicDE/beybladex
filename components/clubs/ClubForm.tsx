// components/clubs/ClubForm.tsx
// Create form for a Club — name + description only (every Club column the user may set; slug
// and owner are server-determined). Posts /api/clubs and redirects to the new club's page.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { errorMessage } from '@/lib/errorCopy'
import { CLUB_DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'

export function ClubForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch('/api/clubs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    })
    setPending(false)
    if (res.ok) {
      const body = await res.json()
      router.push(`/clubs/${body.slug}`)
      router.refresh()
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <FormField label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </FormField>
      <FormField label="Beschreibung (optional, Markdown)">
        <MarkdownEditor value={description} onChange={setDescription} rows={4} maxLength={CLUB_DESCRIPTION_MAX} />
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Erstelle…' : 'Club erstellen'}
      </Button>
    </form>
  )
}
