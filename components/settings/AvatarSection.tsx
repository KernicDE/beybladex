// components/settings/AvatarSection.tsx (Phase 21, item 3)
// The settings-page avatar manager: current preview (or the generic initial-letter
// placeholder when none is set), a file picker that uploads on selection, and an
// "Entfernen" button that only renders while an avatar is set (per Issue #15's acceptance
// criteria the delete path must be reachable from the UI, not just the API). Modeled
// directly on components/tournament/HeaderImageUpload.tsx; both endpoints are
// session/self-only server-side — this component just doesn't render for anyone else.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { errorMessage } from '@/lib/errorCopy'
import { Button } from '@/components/ui/Button'

export function AvatarSection({ username, avatarImageId }: { username: string; avatarImageId: string | null }) {
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
    const res = await fetch('/api/profile/avatar', { method: 'POST', body: form })
    setPending(false)
    // Reset the input so selecting the SAME file again still fires onChange.
    e.target.value = ''
    if (res.ok) {
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  async function remove() {
    setPending(true)
    setError(null)
    const res = await fetch('/api/profile/avatar', { method: 'DELETE' })
    setPending(false)
    if (res.ok) {
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  return (
    <section aria-labelledby="avatar-heading" className="space-y-2">
      <h3 id="avatar-heading" className="text-sm font-semibold">Profilbild</h3>
      <div className="flex items-center gap-3">
        {avatarImageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- small settings-page preview of the viewer's OWN avatar (always visible to themselves, no privacy gate)
          <img src={`/api/media/${avatarImageId}`} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-full bg-x-cyan/15 text-xl font-semibold text-x-cyan-text dark:text-x-cyan"
          >
            {(username[0] ?? '?').toUpperCase()}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={upload}
            disabled={pending}
            aria-label="Profilbild hochladen"
            className="text-sm"
          />
          {avatarImageId && (
            <Button variant="secondary" size="sm" onClick={remove} disabled={pending}>
              Entfernen
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Das Bild wird als quadratisches WebP (256 × 256) gespeichert. Ein neues Upload ersetzt
        das aktuelle Bild; über “Entfernen” stellst du den Standardplatzhalter wieder her.
      </p>
    </section>
  )
}
