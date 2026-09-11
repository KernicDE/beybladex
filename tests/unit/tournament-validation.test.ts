// tests/unit/tournament-validation.test.ts (RC6, issue #35)
// Direct unit coverage for lib/tournamentValidation.ts — the whitelisted-field parser behind
// POST /api/tournaments and PATCH /api/tournaments/[id]. The schema IS the API contract
// (error tokens are surfaced 1:1 to clients), so these pin both the happy paths and the
// exact tokens for the common invalid configurations. Pure function — no HTTP, no DB.
import { describe, it, expect } from 'vitest'
import { parseTournamentInput } from '@/lib/tournamentValidation'

const VALID_POST = {
  title: 'Berlin Burst Open',
  startDate: '2026-10-03T10:00:00.000Z',
  locationName: 'Spielhalle Mitte',
  postalCode: '10115',
  city: 'Berlin',
  state: 'Berlin',
  country: 'DE',
  latitude: 52.52,
  longitude: 13.405,
  currency: 'EUR',
  rulesetId: 'ruleset-1',
}

describe('parseTournamentInput — POST (partial: false)', () => {
  it('accepts a valid minimal body and coerces startDate to a Date', () => {
    const { data, errors } = parseTournamentInput(VALID_POST, false)
    expect(errors).toEqual([])
    expect(data.title).toBe('Berlin Burst Open')
    expect(data.startDate).toBeInstanceOf(Date)
    expect(data.country).toBe('DE')
    expect(data.currency).toBe('EUR')
    expect(data.rulesetId).toBe('ruleset-1')
  })

  it('every POST-required field absence produces its token', () => {
    const { data, errors } = parseTournamentInput({}, false)
    expect(data).toEqual({})
    for (const token of [
      'invalid_title', 'invalid_start_date', 'invalid_location', 'invalid_postal_code',
      'invalid_city', 'invalid_state', 'invalid_country', 'invalid_latitude',
      'invalid_longitude', 'invalid_currency', 'invalid_ruleset',
    ]) {
      expect(errors).toContain(token)
    }
  })

  it('rejects out-of-range coordinates with the dedicated tokens', () => {
    const { errors } = parseTournamentInput({ ...VALID_POST, latitude: 91 }, false)
    expect(errors).toContain('invalid_latitude')
    const { errors: lonErrors } = parseTournamentInput({ ...VALID_POST, longitude: -181 }, false)
    expect(lonErrors).toContain('invalid_longitude')
  })

  it('rejects unknown countries and currencies', () => {
    expect(parseTournamentInput({ ...VALID_POST, country: 'FR' }, false).errors).toContain('invalid_country')
    expect(parseTournamentInput({ ...VALID_POST, currency: 'GBP' }, false).errors).toContain('invalid_currency')
  })

  it('rejects a negative or absurd entry fee', () => {
    expect(parseTournamentInput({ ...VALID_POST, entryFeeCent: -1 }, false).errors).toContain('invalid_entry_fee')
    expect(parseTournamentInput({ ...VALID_POST, entryFeeCent: 2_000_000 }, false).errors).toContain('invalid_entry_fee')
  })

  it('accepts nullable optionals (description/endDate/street) as null but rejects null for required fields', () => {
    const { errors } = parseTournamentInput({ ...VALID_POST, description: null, endDate: null, street: null }, false)
    expect(errors).toEqual([])
    expect(parseTournamentInput({ ...VALID_POST, title: null }, false).errors).toContain('invalid_title')
  })

  it('recurringDays must be a weekday integer 0..6; null is allowed', () => {
    expect(parseTournamentInput({ ...VALID_POST, recurringDays: 7 }, false).errors).toContain('invalid_recurring_days')
    expect(parseTournamentInput({ ...VALID_POST, recurringDays: 1.5 }, false).errors).toContain('invalid_recurring_days')
    expect(parseTournamentInput({ ...VALID_POST, recurringDays: null }, false).errors).toEqual([])
  })

  it('accepts clubId on POST (null = no club) and rejects empty strings', () => {
    const withClub = parseTournamentInput({ ...VALID_POST, clubId: 'club-1' }, false)
    expect(withClub.errors).toEqual([])
    expect(withClub.data.clubId).toBe('club-1')
    const noClub = parseTournamentInput({ ...VALID_POST, clubId: null }, false)
    expect(noClub.errors).toEqual([])
    expect(noClub.data.clubId).toBeNull()
    expect(parseTournamentInput({ ...VALID_POST, clubId: '' }, false).errors).toContain('invalid_club')
  })

  it('trims padded strings and rejects whitespace-only titles', () => {
    const { data } = parseTournamentInput({ ...VALID_POST, title: '  Berlin Burst Open  ' }, false)
    expect(data.title).toBe('Berlin Burst Open')
    expect(parseTournamentInput({ ...VALID_POST, title: '   ' }, false).errors).toContain('invalid_title')
  })

  it('ignores unknown fields (no mass assignment)', () => {
    const { data, errors } = parseTournamentInput({ ...VALID_POST, createdById: 'evil', startedAt: 'x' }, false)
    expect(errors).toEqual([])
    expect(data).not.toHaveProperty('createdById')
    expect(data).not.toHaveProperty('startedAt')
  })
})

describe('parseTournamentInput — PATCH (partial: true)', () => {
  it('accepts a single recognized field', () => {
    const { data, errors } = parseTournamentInput({ title: 'Neuer Titel' }, true)
    expect(errors).toEqual([])
    expect(data).toEqual({ title: 'Neuer Titel' })
  })

  it('a recognized field with a wrong type is an error, not silently dropped', () => {
    expect(parseTournamentInput({ title: 42 }, true).errors).toContain('invalid_title')
    expect(parseTournamentInput({ latitude: 'north' }, true).errors).toContain('invalid_latitude')
  })

  it('an empty body is rejected with no_fields', () => {
    expect(parseTournamentInput({}, true).errors).toEqual(['no_fields'])
  })

  it('clubId is POST-only: on PATCH it is an ignored unknown (body of only clubId → no_fields)', () => {
    const { data, errors } = parseTournamentInput({ clubId: 'club-1' }, true)
    expect(errors).toEqual(['no_fields'])
    expect(data).not.toHaveProperty('clubId')
  })

  it('unknown fields alone also yield no_fields', () => {
    expect(parseTournamentInput({ hackerField: true }, true).errors).toEqual(['no_fields'])
  })
})
