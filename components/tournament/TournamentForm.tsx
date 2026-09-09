// components/tournament/TournamentForm.tsx
// Create form for a Tournament — every Tournament column is covered, no invented fields.
// Club attachment (Phase 4): an optional clubId dropdown, populated by the page with the
// session user's ADMINISTERED clubs only (owner/isAdmin memberships) — the API independently
// verifies ClubMember.isAdmin, so the dropdown is a convenience, not the authorization.
// Posts /api/tournaments and redirects to /events/<id>.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { errorMessage } from '@/lib/errorCopy'

export interface RulesetOption {
  id: string
  title: string
}

export interface ClubOption {
  id: string
  name: string
}

export interface TournamentFormValues {
  title: string
  description: string
  startDate: string
  endDate: string
  locationName: string
  street: string
  postalCode: string
  city: string
  state: string
  country: string
  latitude: string
  longitude: string
  entryFeeCent: string
  currency: string
  isRecurring: boolean
  recurringDays: string
  rulesetId: string
  clubId: string
}

export const DEFAULT_TOURNAMENT_VALUES: TournamentFormValues = {
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  locationName: '',
  street: '',
  postalCode: '',
  city: '',
  state: '',
  country: 'DE',
  latitude: '',
  longitude: '',
  entryFeeCent: '0',
  currency: 'EUR',
  isRecurring: false,
  recurringDays: '',
  rulesetId: '',
  clubId: '',
}

const COUNTRIES = [
  { value: 'DE', label: 'Deutschland' },
  { value: 'AT', label: 'Österreich' },
  { value: 'CH', label: 'Schweiz' },
] as const

const CURRENCIES = [
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'CHF', label: 'CHF' },
  { value: 'USD', label: 'USD ($)' },
] as const

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const

export function TournamentForm({ rulesets, clubs = [], initialClubId = '' }: { rulesets: RulesetOption[]; clubs?: ClubOption[]; initialClubId?: string }) {
  const router = useRouter()
  const [values, setValues] = useState<TournamentFormValues>({
    ...DEFAULT_TOURNAMENT_VALUES,
    rulesetId: rulesets[0]?.id ?? '',
    // Pre-selection (e.g. from a club page's "Neues Club-Event" button) only honors clubs the
    // user actually administers — unknown ids fall back to "no club".
    clubId: clubs.some((c) => c.id === initialClubId) ? initialClubId : '',
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setText = (key: keyof TournamentFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const payload = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      startDate: new Date(values.startDate).toISOString(),
      endDate: values.endDate ? new Date(values.endDate).toISOString() : null,
      locationName: values.locationName.trim(),
      street: values.street.trim() || null,
      postalCode: values.postalCode.trim(),
      city: values.city.trim(),
      state: values.state.trim(),
      country: values.country,
      latitude: Number(values.latitude),
      longitude: Number(values.longitude),
      entryFeeCent: Math.round(Number(values.entryFeeCent) * 100),
      currency: values.currency,
      isRecurring: values.isRecurring,
      recurringDays: values.recurringDays === '' ? null : Number(values.recurringDays),
      rulesetId: values.rulesetId,
      clubId: values.clubId || null,
    }
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setPending(false)
    if (res.ok) {
      const body = await res.json()
      router.push(`/events/${body.id}`)
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

      <FormField label="Beschreibung">
        <Textarea value={values.description} onChange={setText('description')} rows={4} maxLength={2000} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Beginn">
          <Input type="datetime-local" value={values.startDate} onChange={setText('startDate')} required />
        </FormField>
        <FormField label="Ende (optional)">
          <Input type="datetime-local" value={values.endDate} onChange={setText('endDate')} />
        </FormField>
      </div>

      <FormField label="Veranstaltungsort">
        <Input value={values.locationName} onChange={setText('locationName')} maxLength={200} required />
      </FormField>

      <FormField label="Straße (optional)">
        <Input value={values.street} onChange={setText('street')} maxLength={200} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="PLZ">
          <Input value={values.postalCode} onChange={setText('postalCode')} maxLength={10} required />
        </FormField>
        <FormField label="Stadt">
          <Input value={values.city} onChange={setText('city')} maxLength={100} required />
        </FormField>
        <FormField label="Bundesland / Kanton">
          <Input value={values.state} onChange={setText('state')} maxLength={100} required />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Land">
          <Select value={values.country} onChange={setText('country')}>
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Eintritt (Betrag)">
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={values.entryFeeCent}
            onChange={setText('entryFeeCent')}
          />
        </FormField>
        <FormField label="Währung">
          <Select value={values.currency} onChange={setText('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* TODO: once lib/geo.ts lands, auto-geocode from postalCode+country instead of manual entry. */}
        <FormField label="Breitengrad (Lat)">
          <Input
            type="number"
            min={-90}
            max={90}
            step="any"
            inputMode="decimal"
            value={values.latitude}
            onChange={setText('latitude')}
            required
          />
        </FormField>
        <FormField label="Längengrad (Lng)">
          <Input
            type="number"
            min={-180}
            max={180}
            step="any"
            inputMode="decimal"
            value={values.longitude}
            onChange={setText('longitude')}
            required
          />
        </FormField>
      </div>

      <FormField label="Regelwerk">
        <Select value={values.rulesetId} onChange={setText('rulesetId')} required>
          {rulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </FormField>

      {/* Club attachment: only rendered when the session user administers at least one club
          (the page populates `clubs` accordingly). Empty option = a non-club event. */}
      {clubs.length > 0 && (
        <FormField label="Club (optional)">
          <Select value={values.clubId} onChange={setText('clubId')}>
            <option value="">Kein Club</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <div className="flex items-start gap-3">
        <input
          id="tournament-isRecurring"
          type="checkbox"
          checked={values.isRecurring}
          onChange={(e) => setValues((v) => ({ ...v, isRecurring: e.target.checked }))}
          className="mt-0.5 size-4 shrink-0 accent-x-cyan"
        />
        <label htmlFor="tournament-isRecurring" className="text-sm">
          Wiederkehrender Event
          <span className="block text-xs text-current/60">Findet regelmäßig an einem festen Wochentag statt.</span>
        </label>
      </div>

      {values.isRecurring && (
        <FormField label="Wiederholungstag">
          <Select value={values.recurringDays} onChange={setText('recurringDays')}>
            <option value="">Bitte wählen</option>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending || rulesets.length === 0}>
        {pending ? 'Erstelle…' : 'Turnier erstellen'}
      </Button>
      {rulesets.length === 0 && (
        <p className="text-sm text-current/60">
          Es gibt noch keine Regelwerke — du brauchst ein öffentliches Regelwerk, bevor du ein Turnier erstellen kannst.
        </p>
      )}
    </form>
  )
}
