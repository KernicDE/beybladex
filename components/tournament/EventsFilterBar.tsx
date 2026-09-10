// components/tournament/EventsFilterBar.tsx (Phase 10, items 1 + 8)
// The /events filter bar's interactive half: country + Bundesland/Kanton dropdown (item 1 —
// replaces the old free-text state input; the dropdown's options are filtered to the
// currently-selected country's region list, disabled with "Land auswählen" when no country is
// picked) plus a Von/Bis date range (item 8). Still a plain GET form (server component parent
// keeps the SearchInput/submit button around this), so every filter combination stays a
// shareable URL — the client-side piece is ONLY the reactive state-options filtering, which a
// server-rendered <select> can't do without a page reload.
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
}: {
  initialCountry: string
  initialState: string
  initialFrom: string
  initialTo: string
}) {
  const [country, setCountry] = useState(initialCountry)
  // The state value stays whatever the URL had, even if it doesn't match the newly-selected
  // country's list yet — the user still needs to actively re-pick it; we don't silently clear
  // a real filter value on a stray click.
  const [state, setState] = useState(initialState)

  const regions = country ? DACH_REGIONS[country as DachCountry] : null

  return (
    <>
      <div className="sm:w-48">
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
      <div className="sm:w-48">
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
      <div className="sm:w-40">
        <label htmlFor="filter-from" className="mb-1 block text-sm">
          Von
        </label>
        <Input id="filter-from" name="from" type="date" defaultValue={initialFrom} />
      </div>
      <div className="sm:w-40">
        <label htmlFor="filter-to" className="mb-1 block text-sm">
          Bis
        </label>
        <Input id="filter-to" name="to" type="date" defaultValue={initialTo} />
      </div>
    </>
  )
}
