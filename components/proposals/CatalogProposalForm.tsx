// components/proposals/CatalogProposalForm.tsx
// Phase 11 (item 1): the structured "Teil/Set nicht gefunden? Vorschlagen" form — replaces
// PartRequestCTA's free-text-only flow. Any logged-in user submits; TRUSTED/JUDGE/ORGANIZER/
// ADMIN review at /settings/admin/parts. POSTs multipart FormData to /api/proposals:
//   kind=PART  — full Part shape (name, manufacturer, category, weight, spin direction,
//                beyType, notes) + optional image (item 0's pipeline)
//   kind=BUILD — Set name + three slots, each an existing Part.id OR an inline-new Part
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { errorMessage } from '@/lib/errorCopy'

const SLOT_DEFS = [
  { key: 'blade', label: 'Blade', category: 'BLADE' },
  { key: 'ratchet', label: 'Ratchet', category: 'RATCHET' },
  { key: 'bit', label: 'Bit', category: 'BIT' },
] as const

interface PartOption {
  id: string
  name: string
}

interface InlinePartFields {
  name: string
  manufacturer: string
  beyType: string
  spinDirection: string
  weightGrams: string
}

const EMPTY_INLINE: InlinePartFields = {
  name: '',
  manufacturer: 'TT',
  beyType: '',
  spinDirection: 'RIGHT',
  weightGrams: '',
}

function ExistingPartPicker({
  category,
  value,
  onChange,
}: {
  category: string
  value: PartOption | null
  onChange: (p: PartOption | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PartOption[]>([])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/parts/search?category=${category}&q=${encodeURIComponent(query.trim())}`)
    if (!res.ok) return
    const body = (await res.json()) as { parts: PartOption[] }
    setResults(body.parts)
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-x-cyan/20 p-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{value.name}</p>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Ändern</Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Teilname…" aria-label="Teil im Katalog suchen" />
        <Button variant="secondary" size="sm" onClick={search}>Suchen</Button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-36 divide-y overflow-y-auto rounded-xl border">
          {results.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm">{p.name}</p>
              <Button size="sm" onClick={() => onChange(p)}>Wählen</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InlinePartFieldsEditor({
  fields,
  onChange,
}: {
  fields: InlinePartFields
  onChange: (f: InlinePartFields) => void
}) {
  const set = (key: keyof InlinePartFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...fields, [key]: e.target.value })
  return (
    <div className="grid gap-2 rounded-xl border border-current/10 p-3 sm:grid-cols-2">
      <FormField label="Name">
        <Input required value={fields.name} onChange={set('name')} />
      </FormField>
      <FormField label="Hersteller">
        <Select value={fields.manufacturer} onChange={set('manufacturer')}>
          <option value="TT">Takara Tomy</option>
          <option value="HASBRO">Hasbro</option>
        </Select>
      </FormField>
      <FormField label="Bey-Typ (optional)">
        <Select value={fields.beyType} onChange={set('beyType')}>
          <option value="">—</option>
          <option value="ATTACK">Angriff</option>
          <option value="DEFENSE">Verteidigung</option>
          <option value="STAMINA">Ausdauer</option>
          <option value="BALANCE">Balance</option>
        </Select>
      </FormField>
      <FormField label="Drehrichtung">
        <Select value={fields.spinDirection} onChange={set('spinDirection')}>
          <option value="RIGHT">Rechts</option>
          <option value="LEFT">Links</option>
        </Select>
      </FormField>
      <FormField label="Gewicht in Gramm (optional)">
        <Input type="number" min={0} step="0.01" value={fields.weightGrams} onChange={set('weightGrams')} />
      </FormField>
    </div>
  )
}

function buildSlotPayload(
  mode: Record<string, 'existing' | 'new'>,
  existing: Record<string, PartOption | null>,
  inline: Record<string, InlinePartFields>,
) {
  const slots: Record<string, unknown> = {}
  for (const def of SLOT_DEFS) {
    if (mode[def.key] === 'existing') {
      slots[def.key] = { partId: existing[def.key]?.id ?? null }
    } else {
      const f = inline[def.key]
      slots[def.key] = {
        inline: {
          name: f.name,
          manufacturer: f.manufacturer,
          beyType: f.beyType === '' ? null : f.beyType,
          spinDirection: f.spinDirection,
          weightGrams: f.weightGrams === '' ? null : Number(f.weightGrams),
        },
      }
    }
  }
  return slots
}

export function CatalogProposalForm({
  defaultKind = 'PART',
  defaultName = '',
  onDone,
}: {
  defaultKind?: 'PART' | 'BUILD'
  defaultName?: string
  onDone?: () => void
}) {
  const [kind, setKind] = useState<'PART' | 'BUILD'>(defaultKind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // kind=PART fields
  const [name, setName] = useState(defaultName)
  const [manufacturer, setManufacturer] = useState('TT')
  const [category, setCategory] = useState('BLADE')
  const [beyType, setBeyType] = useState('')
  const [spinDirection, setSpinDirection] = useState('RIGHT')
  const [weightGrams, setWeightGrams] = useState('')
  const [notes, setNotes] = useState('')

  // kind=BUILD fields
  const [buildSetName, setBuildSetName] = useState('')
  const [slotMode, setSlotMode] = useState<Record<string, 'existing' | 'new'>>(
    Object.fromEntries(SLOT_DEFS.map((d) => [d.key, 'existing'])),
  )
  const [slotExisting, setSlotExisting] = useState<Record<string, PartOption | null>>(
    Object.fromEntries(SLOT_DEFS.map((d) => [d.key, null])),
  )
  const [slotInline, setSlotInline] = useState<Record<string, InlinePartFields>>(
    Object.fromEntries(SLOT_DEFS.map((d) => [d.key, EMPTY_INLINE])),
  )

  const [image, setImage] = useState<File | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData()
    form.set('kind', kind)
    if (kind === 'PART') {
      form.set('name', name)
      form.set('manufacturer', manufacturer)
      form.set('category', category)
      form.set('beyType', beyType)
      form.set('spinDirection', spinDirection)
      form.set('weightGrams', weightGrams)
      form.set('notes', notes)
    } else {
      form.set('name', buildSetName)
      form.set('slots', JSON.stringify(buildSlotPayload(slotMode, slotExisting, slotInline)))
    }
    if (image) form.set('image', image)

    const res = await fetch('/api/proposals', { method: 'POST', body: form })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(errorMessage(body?.error ?? 'unknown'))
      return
    }
    setDone(true)
    onDone?.()
  }

  if (done) {
    return <p className="text-sm text-current/70">Danke! Dein Vorschlag liegt beim Katalog-Team zur Prüfung.</p>
  }

  const slotComplete = SLOT_DEFS.every((d) =>
    slotMode[d.key] === 'existing' ? slotExisting[d.key] !== null : slotInline[d.key].name.trim() !== '',
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={kind === 'PART' ? 'primary' : 'secondary'} onClick={() => setKind('PART')}>
          Neues Teil
        </Button>
        <Button type="button" size="sm" variant={kind === 'BUILD' ? 'primary' : 'secondary'} onClick={() => setKind('BUILD')}>
          Neues Set
        </Button>
      </div>

      {kind === 'PART' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Hersteller">
              <Select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}>
                <option value="TT">Takara Tomy</option>
                <option value="HASBRO">Hasbro</option>
              </Select>
            </FormField>
            <FormField label="Kategorie">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="BLADE">Blade</option>
                <option value="RATCHET">Ratchet</option>
                <option value="BIT">Bit</option>
                <option value="ACCESSORY">Zubehör</option>
              </Select>
            </FormField>
            <FormField label="Bey-Typ (optional)">
              <Select value={beyType} onChange={(e) => setBeyType(e.target.value)}>
                <option value="">—</option>
                <option value="ATTACK">Angriff</option>
                <option value="DEFENSE">Verteidigung</option>
                <option value="STAMINA">Ausdauer</option>
                <option value="BALANCE">Balance</option>
              </Select>
            </FormField>
            <FormField label="Drehrichtung">
              <Select value={spinDirection} onChange={(e) => setSpinDirection(e.target.value)}>
                <option value="RIGHT">Rechts</option>
                <option value="LEFT">Links</option>
              </Select>
            </FormField>
            <FormField label="Gewicht in Gramm (optional)">
              <Input type="number" min={0} step="0.01" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Notiz (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="z. B. erscheint im Set X mit …" />
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Set-Name (z. B. Reaper Rhino C 4-55D)">
            <Input required value={buildSetName} onChange={(e) => setBuildSetName(e.target.value)} maxLength={160} />
          </FormField>
          {SLOT_DEFS.map((def) => (
            <FormField key={def.key} label={def.label}>
              <div>
                <div className="mb-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={slotMode[def.key] === 'existing' ? 'primary' : 'secondary'}
                    onClick={() => setSlotMode((m) => ({ ...m, [def.key]: 'existing' }))}
                  >
                    Aus Katalog
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={slotMode[def.key] === 'new' ? 'primary' : 'secondary'}
                    onClick={() => setSlotMode((m) => ({ ...m, [def.key]: 'new' }))}
                  >
                    Neues Teil
                  </Button>
                </div>
                {slotMode[def.key] === 'existing' ? (
                  <ExistingPartPicker
                    category={def.category}
                    value={slotExisting[def.key]}
                    onChange={(p) => setSlotExisting((v) => ({ ...v, [def.key]: p }))}
                  />
                ) : (
                  <InlinePartFieldsEditor
                    fields={slotInline[def.key]}
                    onChange={(f) => setSlotInline((v) => ({ ...v, [def.key]: f }))}
                  />
                )}
              </div>
            </FormField>
          ))}
        </>
      )}

      <FormField label="Bild (optional — wird auf 512×512 zugeschnitten und als WebP gespeichert)">
        <Input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
        />
      </FormField>

      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button
        type="submit"
        disabled={busy || (kind === 'PART' ? name.trim() === '' : buildSetName.trim() === '' || !slotComplete)}
      >
        Vorschlag einreichen
      </Button>
    </form>
  )
}
