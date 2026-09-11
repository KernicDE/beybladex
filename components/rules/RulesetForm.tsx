// components/rules/RulesetForm.tsx
// Create/edit form for a Ruleset — covers every Ruleset column, no invented fields.
// Create mode POSTs /api/rulesets and redirects to /rules/<slug>; edit mode PATCHes
// /api/rulesets/<slug> and returns to the view. Composed from components/ui primitives.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { errorMessage } from '@/lib/errorCopy'
import { RULESET_DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'
import { DECK_FORMATS, DECK_FORMAT_LABELS, RULESET_FIELD_HINTS } from '@/lib/rulesetLabels'

export type RulesetFormValues = {
  title: string
  description: string
  isPublic: boolean
  deckFormat: string
  targetPoints: string
  finalsTargetPoints: string
  lockedDecks: boolean
  allowForceSwitch: boolean
  arenaTurnAllowed: boolean
  outOfBounds2Pts: boolean
  ownFinishPenalty: boolean
  relaunchLimit: string
  aerialContactRerun: boolean
  externalDisturbanceRerun: boolean
}

// The form defaults ARE the WoB base ruleset (RC10 #72): a new ruleset starts as the
// WoB standard, and every deliberate change is a deviation — canonical values live in
// lib/wobBase.ts and must stay in sync with these.
export const DEFAULT_RULESET_VALUES: RulesetFormValues = {
  title: '',
  description: '',
  isPublic: true,
  deckFormat: 'WBO_COUNTERDECK',
  targetPoints: '4',
  finalsTargetPoints: '7',
  lockedDecks: true,
  allowForceSwitch: true,
  arenaTurnAllowed: true,
  outOfBounds2Pts: true,
  ownFinishPenalty: true,
  relaunchLimit: '1',
  aerialContactRerun: true,
  externalDisturbanceRerun: true,
}

const TOGGLE_FIELDS = [
  { key: 'lockedDecks', label: 'Gesperrte Decks' },
  { key: 'allowForceSwitch', label: 'Force-Switch erlaubt' },
  { key: 'arenaTurnAllowed', label: 'Arena-Drehung erlaubt' },
  { key: 'outOfBounds2Pts', label: 'Out-of-Bounds = 2 Punkte' },
  { key: 'ownFinishPenalty', label: 'Own-Finish-Strafe' },
  { key: 'aerialContactRerun', label: 'Wiederholung bei Luftkontakt' },
  { key: 'externalDisturbanceRerun', label: 'Wiederholung bei äußeren Störungen' },
] as const

const POINT_FIELDS = [
  { key: 'targetPoints', label: 'Zielpunkte (Vorrunde)' },
  { key: 'finalsTargetPoints', label: 'Zielpunkte (Finale)' },
] as const

export function RulesetForm({
  mode,
  initial,
  slug,
}: {
  mode: 'create' | 'edit'
  initial?: Partial<RulesetFormValues>
  slug?: string
}) {
  const router = useRouter()
  const [values, setValues] = useState<RulesetFormValues>({ ...DEFAULT_RULESET_VALUES, ...initial })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setText = (key: keyof RulesetFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))
  const setToggle = (key: keyof RulesetFormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.checked }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const payload = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      isPublic: values.isPublic,
      deckFormat: values.deckFormat,
      targetPoints: Number(values.targetPoints),
      finalsTargetPoints: Number(values.finalsTargetPoints),
      relaunchLimit: Number(values.relaunchLimit),
      lockedDecks: values.lockedDecks,
      allowForceSwitch: values.allowForceSwitch,
      arenaTurnAllowed: values.arenaTurnAllowed,
      outOfBounds2Pts: values.outOfBounds2Pts,
      ownFinishPenalty: values.ownFinishPenalty,
      aerialContactRerun: values.aerialContactRerun,
      externalDisturbanceRerun: values.externalDisturbanceRerun,
    }
    const res = await fetch(mode === 'create' ? '/api/rulesets' : `/api/rulesets/${slug}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setPending(false)
    if (res.ok) {
      const body = await res.json()
      router.push(`/rules/${mode === 'create' ? body.slug : slug}`)
      router.refresh()
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <FormField label="Titel">
        <Input value={values.title} onChange={setText('title')} maxLength={100} required />
      </FormField>

      <FormField label="Beschreibung (Markdown)">
        <MarkdownEditor value={values.description} onChange={(description) => setValues((v) => ({ ...v, description }))} rows={4} maxLength={RULESET_DESCRIPTION_MAX} />
      </FormField>

      <FormField label="Deck-Format">
        <Select value={values.deckFormat} onChange={setText('deckFormat')}>
          {DECK_FORMATS.map((format) => (
            <option key={format} value={format}>
              {DECK_FORMAT_LABELS[format]}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        {POINT_FIELDS.map(({ key, label }) => (
          <FormField key={key} label={label}>
            <Input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={values[key]}
              onChange={setText(key)}
            />
          </FormField>
        ))}
        <FormField label="Relaunch-Limit">
          <Input
            type="number"
            min={0}
            max={10}
            inputMode="numeric"
            value={values.relaunchLimit}
            onChange={setText('relaunchLimit')}
          />
        </FormField>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-x-cyan/20 p-4">
        <legend className="px-1 text-sm font-medium">Sonderregeln</legend>
        {TOGGLE_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-start gap-3">
            <input
              id={`ruleset-${key}`}
              type="checkbox"
              checked={values[key] as boolean}
              onChange={setToggle(key)}
              className="mt-0.5 size-4 shrink-0 accent-x-cyan"
            />
            <label htmlFor={`ruleset-${key}`} className="text-sm">
              {label}
              <span className="block text-xs text-current/60">{RULESET_FIELD_HINTS[key]}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <div className="flex items-start gap-3">
        <input
          id="ruleset-isPublic"
          type="checkbox"
          checked={values.isPublic}
          onChange={setToggle('isPublic')}
          className="mt-0.5 size-4 shrink-0 accent-x-cyan"
        />
        <label htmlFor="ruleset-isPublic" className="text-sm">
          Öffentlich
          <span className="block text-xs text-current/60">{RULESET_FIELD_HINTS.isPublic}</span>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Speichere…' : mode === 'create' ? 'Regelwerk erstellen' : 'Änderungen speichern'}
      </Button>
    </form>
  )
}
