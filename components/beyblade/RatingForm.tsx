// components/beyblade/RatingForm.tsx
// Create/edit a rating+comment on a build. One rating per user per build — POST upserts
// server-side (@@unique([buildId, userId])), so this same form handles "first rating" and
// "edit mine" (pass `existing`). Client-side companion of the server-side enforcement.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { StarRatingInput } from '@/components/beyblade/StarRatingInput'
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
  const [stars, setStars] = useState(existing?.stars ?? 5)
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
      body: JSON.stringify({ stars, comment: comment.trim() || null }),
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
      {/* RC16 (#107): Hover-Sterne statt Dropdown — die Eingabe-UI ändert sich, das POST-Body-Format nicht. */}
      <FormField label="Sterne">
        <StarRatingInput value={stars} onChange={setStars} />
      </FormField>
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
