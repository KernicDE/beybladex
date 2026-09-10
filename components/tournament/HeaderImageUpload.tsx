// components/tournament/HeaderImageUpload.tsx (Phase 11, item 5)
// Organizer-console upload for the event's header image (POST .../header-image, organizer/
// ADMIN-only server-side — this component just doesn't render for anyone else).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { errorMessage } from '@/lib/errorCopy'

export function HeaderImageUpload({ tournamentId, headerImageId }: { tournamentId: string; headerImageId: string | null }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPending(true)
    setError(null)
    const form = new FormData()
    form.set('image', file)
    const res = await fetch(`/api/tournaments/${tournamentId}/header-image`, { method: 'POST', body: form })
    setPending(false)
    if (res.ok) {
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  return (
    <section aria-labelledby="header-image-heading" className="space-y-2">
      <h3 id="header-image-heading" className="text-sm font-semibold">Event-Header-Bild</h3>
      <div className="flex items-center gap-3">
        {headerImageId && (
          // eslint-disable-next-line @next/next/no-img-element -- small console preview thumbnail
          <img src={`/api/media/${headerImageId}`} alt="" className="h-16 w-40 rounded-md object-cover" />
        )}
        <input type="file" accept="image/*" onChange={upload} disabled={pending} className="text-sm" />
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </section>
  )
}
