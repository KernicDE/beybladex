// components/admin/PartForm.tsx
// Catalog curation form — POST (create) or PATCH (edit) /api/admin/parts. Server components
// render one per existing part (prefilled) plus one empty "Neues Teil" instance; the server
// is the authz gate (TRUSTED/ADMIN), this form just calls the API and refreshes on success.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export interface PartFormValues {
  id?: string
  name: string
  manufacturer: string
  category: string
  beyType: string
  spinDirection: string
  weightGrams: string
  imageUrl: string
}

const EMPTY: PartFormValues = {
  name: '',
  manufacturer: 'TT',
  category: 'BLADE',
  beyType: '',
  spinDirection: 'RIGHT',
  weightGrams: '',
  imageUrl: '',
}

export function PartForm({ initial = EMPTY }: { initial?: PartFormValues }) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = Boolean(initial.id)

  const set = (key: keyof PartFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload: Record<string, unknown> = {
      name: values.name,
      manufacturer: values.manufacturer,
      category: values.category,
      beyType: values.beyType === '' ? null : values.beyType,
      spinDirection: values.spinDirection,
      weightGrams: values.weightGrams === '' ? null : Number(values.weightGrams),
      imageUrl: values.imageUrl === '' ? null : values.imageUrl,
    }
    if (editing) payload.id = initial.id
    const res = await fetch('/api/admin/parts', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    if (!editing) setValues(EMPTY)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          <Input required value={values.name} onChange={set('name')} placeholder="z. B. DranSword 3-60" />
        </FormField>
        <FormField label="Hersteller">
          <Select value={values.manufacturer} onChange={set('manufacturer')}>
            <option value="TT">Takara Tomy</option>
            <option value="HASBRO">Hasbro</option>
          </Select>
        </FormField>
        <FormField label="Kategorie">
          <Select value={values.category} onChange={set('category')}>
            <option value="BLADE">Blade</option>
            <option value="RATCHET">Ratchet</option>
            <option value="BIT">Bit</option>
            <option value="ACCESSORY">Zubehör</option>
          </Select>
        </FormField>
        <FormField label="Bey-Typ (optional)">
          <Select value={values.beyType} onChange={set('beyType')}>
            <option value="">—</option>
            <option value="ATTACK">Angriff</option>
            <option value="DEFENSE">Verteidigung</option>
            <option value="STAMINA">Ausdauer</option>
            <option value="BALANCE">Balance</option>
          </Select>
        </FormField>
        <FormField label="Drehrichtung">
          <Select value={values.spinDirection} onChange={set('spinDirection')}>
            <option value="RIGHT">Rechts</option>
            <option value="LEFT">Links</option>
          </Select>
        </FormField>
        <FormField label="Gewicht in Gramm (optional)">
          <Input type="number" min="0" step="0.01" value={values.weightGrams} onChange={set('weightGrams')} />
        </FormField>
      </div>
      <FormField label="Bild-URL (lokal, ab / — optional)">
        <Input value={values.imageUrl} onChange={set('imageUrl')} placeholder="/parts/dransword-3-60.png" />
      </FormField>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy}>
        {editing ? 'Änderungen speichern' : 'Teil anlegen'}
      </Button>
    </form>
  )
}
