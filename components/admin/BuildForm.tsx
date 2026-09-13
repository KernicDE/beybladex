// components/admin/BuildForm.tsx (RC16 #108)
// Kuratieren direkt auf der Build-Detailseite: Name (leer = kein kuratierter Set-Name, die
// Anzeige faellt auf die kanonische Ableitung zurueck — der Server speichert null, NICHT den
// abgeleiteten Namen) und Bey-Typ aendern (PATCH /api/admin/builds/[id]), plus Bild-Upload
// (POST /api/admin/builds/[id]/image). Der Server ist das Authz-Gate (requireCurator);
// sichtbar wird das Formular nur fuer das Direct-Authoring-Tier (TRUSTED/ADMIN, siehe
// app/settings/admin/parts/page.tsx) — dieselbe Rollenlogik wie beim Part-Edit.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export interface BuildFormValues {
  id: string
  name: string
  type: 'ATTACK' | 'DEFENSE' | 'STAMINA' | 'BALANCE'
  imageId: string | null
}

export function BuildForm({ initial }: { initial: BuildFormValues }) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [imagePending, setImagePending] = useState(false)

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImagePending(true)
    setError(null)
    const form = new FormData()
    form.set('image', file)
    const res = await fetch(`/api/admin/builds/${initial.id}/image`, { method: 'POST', body: form })
    setImagePending(false)
    if (res.ok) {
      router.refresh()
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Bild-Upload fehlgeschlagen (${res.status})`)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/builds/${initial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Leeres Name-Feld → null (kein kuratierter Name), nicht Leerstring.
      body: JSON.stringify({ name: values.name.trim() === '' ? null : values.name.trim(), type: values.type }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name (optional — leer lässt die kanonische Ableitung gelten)">
          <Input value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder="z. B. Sword Dran 3-60F" />
        </FormField>
        <FormField label="Bey-Typ">
          <Select value={values.type} onChange={(e) => setValues((v) => ({ ...v, type: e.target.value as BuildFormValues['type'] }))}>
            <option value="ATTACK">Angriff</option>
            <option value="DEFENSE">Verteidigung</option>
            <option value="STAMINA">Ausdauer</option>
            <option value="BALANCE">Balance</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Bild (optional)">
        <div className="flex items-center gap-3">
          {values.imageId && (
            // eslint-disable-next-line @next/next/no-img-element -- small admin-only catalog thumbnail
            <img src={`/api/media/${values.imageId}`} alt="" className="size-16 rounded-md bg-current/5 object-contain" />
          )}
          <input type="file" accept="image/*" onChange={uploadImage} disabled={imagePending} className="text-sm" />
        </div>
      </FormField>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy}>
        Änderungen speichern
      </Button>
    </form>
  )
}
