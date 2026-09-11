// tests/unit/tournament-form.test.tsx
// Phase 9: location autofill behavior in TournamentForm —
//  - currency auto-fills from the picked country, but never overrides a currency the
//    organizer hand-edited,
//  - the address type-ahead fills street/postalCode/city/state/country/coordinates on
//    selection,
//  - coordinates stay manually editable and are not silently overwritten by a later
//    automatic full-address geocode result.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TournamentForm, type AddressSuggestion } from '@/components/tournament/TournamentForm'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const MUNICH_SUGGESTION: AddressSuggestion = {
  displayName: 'Marienplatz 1, 80331 München, Bayern, Deutschland',
  street: 'Marienplatz 1',
  postalCode: '80331',
  city: 'München',
  state: 'Bayern',
  country: 'DE',
  lat: 48.1371,
  lng: 11.5754,
}

const BERLIN_SUGGESTION: AddressSuggestion = {
  displayName: 'Karl-Liebknecht-Str. 1, 10115 Berlin, Deutschland',
  street: 'Karl-Liebknecht-Str. 1',
  postalCode: '10115',
  city: 'Berlin',
  state: 'Berlin',
  country: 'DE',
  lat: 52.5219,
  lng: 13.4132,
}

// fetch router: autocomplete vs full-address geocode get different canned responses. A
// geocode for the city «Nowhere» deliberately resolves to nothing (#100's unresolvable case).
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/api/geo/geocode')) {
    if (url.includes('city=Nowhere')) return new Response(JSON.stringify({}), { status: 200 })
    return new Response(JSON.stringify({ suggestion: BERLIN_SUGGESTION }), { status: 200 })
  }
  return new Response(JSON.stringify({ suggestions: [MUNICH_SUGGESTION] }), { status: 200 })
})
vi.stubGlobal('fetch', fetchMock)

// #100 — the Lat/Lng fields live behind the advanced disclosure and stay hidden by default.
function expandAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: /Erweitert/ }))
}

function renderForm() {
  return render(<TournamentForm rulesets={[{ id: 'r1', title: 'Standard' }]} />)
}

// Text inputs expose role "textbox"; number inputs expose role "spinbutton" — both are
// reachable by their FormField label.
const field = (name: string) => screen.getByLabelText(name)
const combobox = (name: string) => screen.getByRole('combobox', { name })

beforeEach(() => {
  // Debounced autocomplete (300ms) / geocode (600ms) effects run on fake timers — no real
  // sleeps anywhere in this file (#68).
  vi.useFakeTimers()
  fetchMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TournamentForm — currency auto-selected by country (Phase 9)', () => {
  it('defaults the currency from EUR to CHF when the country changes to Schweiz, and back for AT', () => {
    renderForm()
    expect(combobox('Währung')).toHaveValue('EUR')
    fireEvent.change(combobox('Land'), { target: { value: 'CH' } })
    expect(combobox('Währung')).toHaveValue('CHF')
    fireEvent.change(combobox('Land'), { target: { value: 'AT' } })
    expect(combobox('Währung')).toHaveValue('EUR')
  })

  it('does not override a currency the organizer already hand-edited', () => {
    renderForm()
    fireEvent.change(combobox('Land'), { target: { value: 'CH' } })
    expect(combobox('Währung')).toHaveValue('CHF')
    fireEvent.change(combobox('Währung'), { target: { value: 'USD' } })
    fireEvent.change(combobox('Land'), { target: { value: 'DE' } })
    expect(combobox('Währung')).toHaveValue('USD')
  })
})

describe('TournamentForm — address autocomplete (Phase 9)', () => {
  it('does not query suggestions for inputs under 3 characters', async () => {
    renderForm()
    fireEvent.change(field('Veranstaltungsort'), { target: { value: 'Sp' } })
    // Advance well past the 300ms autocomplete debounce — still no fetch.
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/geo/autocomplete')),
    ).toBe(false)
  })

  it('shows suggestions while typing and fills all location fields on selection', async () => {
    renderForm()
    fireEvent.change(field('Veranstaltungsort'), { target: { value: 'Marienplatz Arena' } })

    await act(() => vi.advanceTimersByTimeAsync(300)) // autocomplete debounce
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/geo/autocomplete')),
    ).toBe(true)
    const option = screen.getByRole('option', { name: MUNICH_SUGGESTION.displayName })
    fireEvent.click(option)

    expect(field('Straße (optional)')).toHaveValue('Marienplatz 1')
    expect(field('PLZ')).toHaveValue('80331')
    expect(field('Stadt')).toHaveValue('München')
    expect(field('Bundesland / Kanton')).toHaveValue('Bayern')
    expect(combobox('Land')).toHaveValue('DE')
    // the dropdown closes after applying
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // #100 — coordinates land in form state invisibly; they only become visible after
    // expanding the advanced disclosure.
    expect(screen.queryByLabelText('Breitengrad (Lat)')).not.toBeInTheDocument()
    expandAdvanced()
    expect(field('Breitengrad (Lat)')).toHaveValue(48.1371)
    expect(field('Längengrad (Lng)')).toHaveValue(11.5754)
  })

  it('auto-geocodes once street+PLZ+Stadt+Land are filled by hand', async () => {
    renderForm()
    fireEvent.change(field('Straße (optional)'), { target: { value: 'Marienplatz 1' } })
    fireEvent.change(field('PLZ'), { target: { value: '80331' } })
    fireEvent.change(field('Stadt'), { target: { value: 'München' } })

    await act(() => vi.advanceTimersByTimeAsync(600)) // geocode debounce (rescheduled by each change)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/geo/geocode'))).toBe(true)
    // #100 — the background resolution surfaces as a status line, not as visible fields.
    expect(screen.getByRole('status')).toHaveTextContent('Standort gefunden')
    expandAdvanced()
    expect(field('Breitengrad (Lat)')).toHaveValue(52.5219)
    expect(field('Längengrad (Lng)')).toHaveValue(13.4132)
    expect(field('Bundesland / Kanton')).toHaveValue('Berlin')
  })

  it('keeps hand-edited coordinates when a later full-address geocode resolves elsewhere', async () => {
    renderForm()
    // 1. pick the Munich suggestion → coordinates autofilled
    fireEvent.change(field('Veranstaltungsort'), { target: { value: 'Marienplatz Arena' } })
    await act(() => vi.advanceTimersByTimeAsync(300)) // autocomplete debounce
    fireEvent.click(screen.getByRole('option', { name: MUNICH_SUGGESTION.displayName }))
    expandAdvanced()
    expect(field('Breitengrad (Lat)')).toHaveValue(48.1371)

    // 2. organizer hand-corrects the pin…
    fireEvent.change(field('Breitengrad (Lat)'), { target: { value: '48.2' } })

    // 3. …then edits the street, which triggers a full-address geocode resolving to Berlin
    fireEvent.change(field('Straße (optional)'), { target: { value: 'Karl-Liebknecht-Str. 1' } })
    await act(() => vi.advanceTimersByTimeAsync(600)) // geocode debounce

    // the automatic result refreshed the region name, but must not clobber the hand-set pin
    expect(field('Breitengrad (Lat)')).toHaveValue(48.2)
    expect(field('Längengrad (Lng)')).toHaveValue(11.5754)
  })
})

describe('TournamentForm — background geocoding UX (RC11 #100)', () => {
  it('keeps the Lat/Lng inputs hidden behind the advanced disclosure by default', () => {
    renderForm()
    expect(screen.queryByLabelText('Breitengrad (Lat)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Längengrad (Lng)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Erweitert: Standort manuell setzen/ }))
    expect(screen.getByLabelText('Breitengrad (Lat)')).toBeInTheDocument()
    expect(screen.getByLabelText('Längengrad (Lng)')).toBeInTheDocument()
  })

  it('shows an actionable alert for an unresolvable address and blocks submit', async () => {
    renderForm()
    // Fill an address the geocoder cannot resolve.
    fireEvent.change(field('Straße (optional)'), { target: { value: 'Nirgendwo 1' } })
    fireEvent.change(field('PLZ'), { target: { value: '00000' } })
    fireEvent.change(field('Stadt'), { target: { value: 'Nowhere' } })
    await act(() => vi.advanceTimersByTimeAsync(600)) // geocode debounce

    const alerts = screen.getAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes('konnte nicht automatisch gefunden werden'))).toBe(true)

    // Try to submit an otherwise valid form — the guard must stop before POSTing (0/0 would
    // be a "valid" coordinate pair and pin the event in the Gulf of Guinea).
    fireEvent.change(field('Titel'), { target: { value: 'Test Event' } })
    fireEvent.change(field('Datum'), { target: { value: '2026-10-03' } })
    fireEvent.change(field('Uhrzeit von'), { target: { value: '10:00' } })
    fireEvent.change(field('Veranstaltungsort'), { target: { value: 'Test-Arena' } })
    fireEvent.change(field('Bundesland / Kanton'), { target: { value: 'Hessen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turnier erstellen' }))

    // The guard runs synchronously in the submit handler — no findBy* (fake timers stall it).
    expect(screen.getByText(/Der Standort konnte nicht automatisch aus der Adresse ermittelt werden/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/tournaments'))).toBe(false)
  })

  it('starts with the advanced disclosure expanded in edit mode (existing coordinates)', () => {
    render(
      <TournamentForm
        rulesets={[{ id: 'r1', title: 'Standard' }]}
        mode="edit"
        tournamentId="t-1"
        initialValues={{
          title: 'Bestehendes Event',
          description: '',
          date: '2026-10-03',
          startTime: '10:00',
          endTime: '',
          locationName: 'Arena',
          street: 'Marienplatz 1',
          postalCode: '80331',
          city: 'München',
          state: 'Bayern',
          country: 'DE',
          latitude: '48.1371',
          longitude: '11.5754',
          entryFeeCent: '0',
          currency: 'EUR',
          isRecurring: false,
          recurringDays: '',
          rankedEligible: true,
          teamMode: false,
          rulesetId: 'r1',
          clubId: '',
        }}
      />,
    )
    expect(screen.getByLabelText('Breitengrad (Lat)')).toHaveValue(48.1371)
    expect(screen.getByLabelText('Längengrad (Lng)')).toHaveValue(11.5754)
  })
})
