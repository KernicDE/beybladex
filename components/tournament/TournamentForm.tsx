// components/tournament/TournamentForm.tsx
// Create form for a Tournament — every Tournament column is covered, no invented fields.
// Club attachment (Phase 4): an optional clubId dropdown, populated by the page with the
// session user's ADMINISTERED clubs only (owner/isAdmin memberships) — the API independently
// verifies ClubMember.isAdmin, so the dropdown is a convenience, not the authorization.
// Posts /api/tournaments and redirects to /events/<id>.
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { errorMessage } from '@/lib/errorCopy'
import { TOURNAMENT_DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'

// Client-side mirror of lib/geo.ts's AddressSuggestion shape — lib/geo itself is
// server-only (it imports lib/redis), so the form can never import it.
export interface AddressSuggestion {
  displayName: string
  street: string | null
  postalCode: string | null
  city: string | null
  state: string | null
  country: string
  lat: number
  lng: number
}

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

// Phase 9: country → default currency, applied on country change until the organizer
// hand-edits the currency field (a cross-border event or a CH club pricing in EUR can
// always override the default).
const CURRENCY_BY_COUNTRY: Record<string, string> = { DE: 'EUR', AT: 'EUR', CH: 'CHF' }

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const

const AUTOCOMPLETE_DEBOUNCE_MS = 300
const GEOCODE_DEBOUNCE_MS = 600

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

  // Phase 9 location autofill (see lib/geo.ts + app/api/geo/*):
  // - `suggestions` — address type-ahead below the location fields.
  // - `currencyTouched` — once the organizer hand-picks a currency, country changes no
  //   longer overwrite it.
  // - `coordsTouched` — once latitude/longitude are hand-edited (or cleared), automatic
  //   geocoding no longer overwrites them; picking a suggestion explicitly is deliberate
  //   and always (re)places the pin, resetting this flag.
  // - `lastAutoState` — the region name last written by autofill, so a later geocode may
  //   refresh it but never clobber a hand-edited one.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const currencyTouched = useRef(false)
  const coordsTouched = useRef(false)
  const lastAutoState = useRef<string | null>(null)

  const setText = (key: keyof TournamentFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  function onCountryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const country = e.target.value
    setValues((v) => ({
      ...v,
      country,
      ...(currencyTouched.current ? {} : { currency: CURRENCY_BY_COUNTRY[country] ?? v.currency }),
    }))
  }

  function onCurrencyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    currencyTouched.current = true
    setText('currency')(e)
  }

  function onLatitudeChange(e: React.ChangeEvent<HTMLInputElement>) {
    coordsTouched.current = true
    setText('latitude')(e)
  }

  function onLongitudeChange(e: React.ChangeEvent<HTMLInputElement>) {
    coordsTouched.current = true
    setText('longitude')(e)
  }

  function applySuggestion(s: AddressSuggestion) {
    setSuggestions([])
    lastAutoState.current = s.state
    setValues((v) => ({
      ...v,
      street: s.street ?? v.street,
      postalCode: s.postalCode ?? v.postalCode,
      city: s.city ?? v.city,
      state: s.state ?? v.state,
      country: s.country,
      ...(currencyTouched.current ? {} : { currency: CURRENCY_BY_COUNTRY[s.country] ?? v.currency }),
      latitude: String(s.lat),
      longitude: String(s.lng),
    }))
    coordsTouched.current = false
  }

  // Type-ahead: as the organizer types location/street (city/postal code refine the
  // query), ask the server for matching addresses. Debounced; stale responses are dropped.
  useEffect(() => {
    const parts = [values.locationName, values.street, values.postalCode, values.city]
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.join(' ').trim().length < 3) {
      // Don't setState synchronously in the effect body (react-hooks/set-state-in-effect) —
      // the render below already hides stale suggestions once the query is too short
      // (queryTooShort guard), so there's nothing to clear here; the next real fetch
      // (query long enough again) replaces `suggestions` from inside the debounce callback.
      return
    }
    const q = [...parts, values.country].join(', ')
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geo/autocomplete?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          if (!cancelled) setSuggestions([])
          return
        }
        const body = (await res.json()) as { suggestions?: AddressSuggestion[] }
        if (!cancelled) setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : [])
      } catch {
        if (!cancelled) setSuggestions([])
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [values.locationName, values.street, values.postalCode, values.city, values.country])

  // Full-address geocoding (the Phase 3 TODO): once street+postalCode+city+country are
  // filled — by autocomplete or by hand — resolve coordinates and the canonical region.
  // Never overwrites hand-edited coordinates or a hand-edited region name.
  useEffect(() => {
    const { street, postalCode, city, country } = values
    if (!street.trim() || !postalCode.trim() || !city.trim() || !country) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ street, postalCode, city, country })
        const res = await fetch(`/api/geo/geocode?${params}`)
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { suggestion?: AddressSuggestion }
        const suggestion = body.suggestion
        if (!suggestion || cancelled) return
        // Capture before setValues: the updater runs during re-render, AFTER the mutation
        // below — reading the ref inside the updater would compare against the NEW value.
        const prevAutoState = lastAutoState.current
        setValues((v) => ({
          ...v,
          ...(coordsTouched.current ? {} : { latitude: String(suggestion.lat), longitude: String(suggestion.lng) }),
          ...(suggestion.state && (v.state === '' || v.state === prevAutoState) ? { state: suggestion.state } : {}),
        }))
        if (suggestion.state) lastAutoState.current = suggestion.state
      } catch {
        // geocoding is a convenience — the form keeps working with manual coordinates
      }
    }, GEOCODE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [values.street, values.postalCode, values.city, values.country])

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

  // Same "too short" threshold the autocomplete effect above uses to decide whether to fetch —
  // kept as a render-time guard (not synced into state) so a short query hides stale
  // suggestions without a setState-in-effect call.
  const addressQueryTooShort =
    [values.locationName, values.street, values.postalCode, values.city]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ')
      .trim().length < 3

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <FormField label="Titel">
        <Input value={values.title} onChange={setText('title')} maxLength={100} required />
      </FormField>

      <FormField label="Beschreibung (Markdown)">
        <MarkdownEditor value={values.description} onChange={(description) => setValues((v) => ({ ...v, description }))} rows={4} maxLength={TOURNAMENT_DESCRIPTION_MAX} />
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

      {/* Phase 9 address type-ahead: selecting a suggestion fills street/postalCode/city/
          state/country/coordinates at once; every field stays hand-editable afterwards. */}
      {!addressQueryTooShort && suggestions.length > 0 && (
        <div className="rounded-md border border-zinc-300 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-base-dark-alt">
          <ul role="listbox" aria-label="Adressvorschläge">
            {suggestions.map((s) => (
              <li key={`${s.lat}:${s.lng}:${s.displayName}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => applySuggestion(s)}
                  className="block w-full px-3 py-2 text-left hover:bg-x-cyan/10 focus-visible:bg-x-cyan/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text"
                >
                  {s.displayName}
                </button>
              </li>
            ))}
          </ul>
          {/* Nominatim results are OpenStreetMap data — attribution is required outside
              the Leaflet map (see lib/geo.ts compliance notes). */}
          <p className="border-t border-zinc-200 px-3 py-1 text-xs text-current/60 dark:border-zinc-700">
            © OpenStreetMap contributors
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Land">
          <Select value={values.country} onChange={onCountryChange}>
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
          <Select value={values.currency} onChange={onCurrencyChange}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Auto-geocoded from the address above once street+PLZ+Stadt+Land are filled
            (Phase 9) — both fields stay plain editable inputs for hand-correcting the pin. */}
        <FormField label="Breitengrad (Lat)">
          <Input
            type="number"
            min={-90}
            max={90}
            step="any"
            inputMode="decimal"
            value={values.latitude}
            onChange={onLatitudeChange}
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
            onChange={onLongitudeChange}
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
