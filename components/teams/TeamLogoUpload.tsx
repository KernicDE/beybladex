// components/teams/TeamLogoUpload.tsx (issue #198)
// Captain-only team crest/logo manager. Modeled directly on components/settings/AvatarSection.tsx;
// POST/DELETE app/api/teams/[slug]/logo/route.ts enforce the CAPTAIN-tier authz server-side —
// this component just doesn't render for anyone else (guarded by the caller, see TeamSettingsPanel).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { errorMessage } from '@/lib/errorCopy'
import { Button } from '@/components/ui/Button'

export function TeamLogoUpload({ slug, name, logoImageId }: { slug: string; name: string; logoImageId: string | null }) {
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
    const res = await fetch(`/api/teams/${slug}/logo`, { method: 'POST', body: form })
    setPending(false)
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
    const res = await fetch(`/api/teams/${slug}/logo`, { method: 'DELETE' })
    setPending(false)
    if (res.ok) {
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  return (
    <section aria-labelledby="team-logo-heading" className="space-y-2">
      <h3 id="team-logo-heading" className="text-sm font-semibold">Team-Wappen</h3>
      <div className="flex items-center gap-3">
        {logoImageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- small captain-only preview, same trade-off as AvatarSection
          <img src={`/api/media/${logoImageId}`} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-full bg-x-cyan/15 text-xl font-semibold text-x-cyan-text dark:text-x-cyan"
          >
            {(name[0] ?? '?').toUpperCase()}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={upload}
            disabled={pending}
            aria-label="Team-Wappen hochladen"
            className="text-sm"
          />
          {logoImageId && (
            <Button variant="secondary" size="sm" onClick={remove} disabled={pending}>
              Entfernen
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </section>
  )
}
