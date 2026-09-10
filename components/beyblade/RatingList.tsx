// components/beyblade/RatingList.tsx
// Rating/comment list for a build detail page. Each row: stars, author (username — the
// platform identity, always visible per lib/privacy.ts), date, comment. The author's own
// rows get Edit (prefills RatingForm) and Delete; a TRUSTED/ADMIN viewer gets a moderation
// remove on any row (server writes the AuditLog row — see the ratings route). `own` is
// computed server-side and passed in — the client never needs the viewer's id.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { RatingForm } from '@/components/beyblade/RatingForm'

export interface RatingListItem {
  id: string
  stars: number
  comment: string | null
  createdAt: string
  username: string
  own: boolean
}

export function RatingList({
  buildId,
  canModerate,
  ratings,
}: {
  buildId: string
  canModerate: boolean
  ratings: RatingListItem[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function remove(ratingId: string) {
    setBusyId(ratingId)
    await fetch(`/api/builds/${buildId}/ratings?ratingId=${encodeURIComponent(ratingId)}`, { method: 'DELETE' })
    setBusyId(null)
    router.refresh()
  }

  if (ratings.length === 0) {
    return <EmptyState title="Noch keine Bewertungen" description="Sei die erste Person, die diesen Build bewertet." />
  }

  return (
    <ul className="space-y-3">
      {ratings.map((rating) => (
        <li key={rating.id} className="rounded-xl border border-x-cyan/20 p-4">
          {editingId === rating.id ? (
            <div className="space-y-3">
              <RatingForm buildId={buildId} existing={{ ratingId: rating.id, stars: rating.stars, comment: rating.comment }} />
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Abbrechen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium" aria-label={`${rating.stars} von 5 Sternen`}>
                  {'★'.repeat(rating.stars)}
                  <span className="text-current/30">{'★'.repeat(5 - rating.stars)}</span>{' '}
                  <span className="text-sm font-normal text-current/60">@{rating.username}</span>
                </p>
                {rating.comment && <MarkdownContent className="mt-1 text-sm">{rating.comment}</MarkdownContent>}
                <p className="mt-1 text-xs text-current/50">{new Date(rating.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
              </div>
              <div className="flex gap-2">
                {rating.own && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setEditingId(rating.id)}>Bearbeiten</Button>
                    <Button variant="danger" size="sm" disabled={busyId === rating.id} onClick={() => remove(rating.id)}>
                      Löschen
                    </Button>
                  </>
                )}
                {!rating.own && canModerate && (
                  <Button variant="danger" size="sm" disabled={busyId === rating.id} onClick={() => remove(rating.id)}>
                    Entfernen (Moderation)
                  </Button>
                )}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
