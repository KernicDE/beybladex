// components/beyblade/RatingForm.tsx
// Create/edit a rating+comment on a build. One rating per user per build — POST upserts
// server-side (@@unique([buildId, userId])), so this same form handles "first rating" and
// "edit mine" (pass `existing`). Client-side companion of the server-side enforcement.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Select } from '@/components/ui/Select'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { RATING_COMMENT_MAX } from '@/lib/markdownFieldCaps'

export function RatingForm({
  buildId,
  existing = null,
}: {
  buildId: string
  existing?: { ratingId: string; stars: number; comment: string | null } | null
}) {
  const router = useRouter()
  const [stars, setStars] = useState(existing?.stars.toString() ?? '5')
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/builds/${buildId}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: Number(stars), comment: comment.trim() || null }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    setComment('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Sterne">
          <Select value={stars} onChange={(e) => setStars(e.target.value)}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} Sterne</option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Kommentar (optional, Markdown)">
        <MarkdownEditor value={comment} onChange={setComment} rows={3} maxLength={RATING_COMMENT_MAX} placeholder="Wie spielt sich der Build?" />
      </FormField>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy}>
        {existing ? 'Bewertung aktualisieren' : 'Bewertung abgeben'}
      </Button>
    </form>
  )
}
