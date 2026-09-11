// components/tournament/EventsFilterBar.tsx (Phase 10, items 1 + 8; RC9 #33 adds postal-code radius)
// The /events filter bar's interactive half: country + Bundesland/Kanton dropdown (item 1 —
// replaces the old free-text state input; the dropdown's options are filtered to the
// currently-selected country's region list, disabled with "Land auswählen" when no country is
// picked) plus a Von/Bis date range (item 8) and the PLZ + Umkreis radius pair (#33 — the
// server geocodes the PLZ against the selected country, or DE when none is selected).
// Still a plain GET form (server component parent keeps the SearchInput/submit button around
// this), so every filter combination stays a shareable URL — the client-side piece is ONLY the
// reactive state-options filtering, which a server-rendered <select> can't do without a page
// reload.
'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DACH_REGIONS, type DachCountry } from '@/lib/dachRegions'

const COUNTRIES = [
  { value: '', label: 'Alle Länder' },
  { value: 'DE', label: 'Deutschland' },
  { value: 'AT', label: 'Österreich' },
  { value: 'CH', label: 'Schweiz' },
] as const

export function EventsFilterBar({
  initialCountry,
  initialState,
  initialFrom,
  initialTo,
  initialPlz,
  initialRadiusKm,
}: {
  initialCountry: string
  initialState: string
  initialFrom: string
  initialTo: string
  initialPlz: string
  initialRadiusKm: string
}) {
  const [country, setCountry] = useState(initialCountry)
  // The state value stays whatever the URL had, even if it doesn't match the newly-selected
  // country's list yet — the user still needs to actively re-pick it; we don't silently clear
  // a real filter value on a stray click.
  const [state, setState] = useState(initialState)

  const regions = country ? DACH_REGIONS[country as DachCountry] : null

  // #79 — feste sm:-Breiten sind weg: die Grid-Zellen des umgebenden GET-Formulars
  // (app/events/page.tsx, sm:grid-cols-6) bestimmen die Breiten, der Umbruch erfolgt nur
  // noch an der gestalteten Zeilengrenze, nicht mehr inzidentell per flex-wrap.
  return (
    <>
      <div>
        <label htmlFor="filter-country" className="mb-1 block text-sm">
          Land
        </label>
        <Select id="filter-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filter-state" className="mb-1 block text-sm">
          Bundesland / Kanton
        </label>
        <Select
          id="filter-state"
          name="state"
          value={state}
          onChange={(e) => setState(e.target.value)}
          disabled={!regions}
        >
          <option value="">{regions ? 'Alle Regionen' : 'Land auswählen'}</option>
          {regions?.map((r) => (
            <option key={r.code} value={r.name}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filter-from" className="mb-1 block text-sm">
          Von
        </label>
        <Input id="filter-from" name="from" type="date" defaultValue={initialFrom} />
      </div>
      <div>
        <label htmlFor="filter-to" className="mb-1 block text-sm">
          Bis
        </label>
        <Input id="filter-to" name="to" type="date" defaultValue={initialTo} />
      </div>
      <div>
        <label htmlFor="filter-plz" className="mb-1 block text-sm">
          PLZ
        </label>
        <Input
          id="filter-plz"
          name="plz"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="65189"
          defaultValue={initialPlz}
        />
      </div>
      <div>
        <label htmlFor="filter-radius" className="mb-1 block text-sm">
          Umkreis
        </label>
        <Select id="filter-radius" name="radiusKm" defaultValue={initialRadiusKm}>
          <option value="">Egal</option>
          <option value="25">25 km</option>
          <option value="50">50 km</option>
          <option value="100">100 km</option>
        </Select>
      </div>
    </>
  )
}
