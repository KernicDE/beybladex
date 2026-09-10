// lib/tournamentValidation.ts
// Whitelisted-field validation shared by POST /api/tournaments and PATCH /api/tournaments/[id].
// Every accepted field maps 1:1 to a Tournament column — no invented fields, no mass assignment:
// anything not listed here is ignored. `clubId` is accepted on POST as a validated string
// (null = no club); whether the caller may actually attach THAT club is the route's authz job
// (owner/admin ClubMember.isAdmin or a global ORGANIZER/ADMIN role).
import type { Country } from '@prisma/client'
import { TOURNAMENT_DESCRIPTION_MAX as DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'

const TITLE_MAX = 100
const LOCATION_MAX = 200
const POSTAL_CODE_MAX = 10
const CITY_MAX = 100
const STATE_MAX = 100
const STREET_MAX = 200
const FEE_MAX = 1_000_000 // 10.000,00 — generous hard cap, keeps int overflow out
const RECURRING_DAYS_MIN = 0 // day-of-week (0 = Sunday, per JS Date convention)
const RECURRING_DAYS_MAX = 6
const CURRENCIES = ['EUR', 'CHF', 'USD']
const COUNTRIES: string[] = ['DE', 'AT', 'CH']

export type TournamentInputData = {
  title?: string
  description?: string | null
  startDate?: Date
  endDate?: Date | null
  locationName?: string
  street?: string | null
  postalCode?: string
  city?: string
  state?: string
  country?: Country
  latitude?: number
  longitude?: number
  entryFeeCent?: number
  currency?: string
  isRecurring?: boolean
  recurringDays?: number | null
  rulesetId?: string
  clubId?: string | null
  // Phase 14 — opts a casual/friendly/test event out of Elo impact; omitted on POST defaults
  // to the schema's `true` (ranked), matching the organizer's common case.
  rankedEligible?: boolean
}

export type TournamentInput = {
  data: TournamentInputData
  errors: string[]
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// `partial = true` is PATCH semantics: every field optional, but a recognized field with a
// wrong type is an error (not silently dropped). `partial = false` is POST: the required
// columns must be present. Mirrors lib/rulesetValidation.ts.
//
// clubId (Phase 4): accepted on POST only when the caller may administer that club — the
// ROUTE verifies ClubMember.isAdmin (or an ORGANIZER/ADMIN role); this parser only validates
// the shape, never the authorization.
export function parseTournamentInput(body: unknown, partial: false): TournamentInput & { data: TournamentInputData & { title: string; startDate: Date; locationName: string; postalCode: string; city: string; state: string; latitude: number; longitude: number; rulesetId: string } }
export function parseTournamentInput(body: unknown, partial: true): TournamentInput
export function parseTournamentInput(body: unknown, partial: boolean): TournamentInput {
  const result: TournamentInput = { data: {}, errors: [] }
  if (typeof body !== 'object' || body === null) {
    result.errors.push('invalid_body')
    return result
  }
  const fields = body as Record<string, unknown>

  if (fields.title !== undefined || !partial) {
    const title = fields.title
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > TITLE_MAX) {
      result.errors.push('invalid_title')
    } else {
      result.data.title = title.trim()
    }
  }

  if (fields.description !== undefined) {
    const description = fields.description
    if (description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
      result.errors.push('invalid_description')
    } else {
      result.data.description = description
    }
  }

  if (fields.startDate !== undefined || !partial) {
    const startDate = parseDate(fields.startDate)
    if (!startDate) {
      result.errors.push('invalid_start_date')
    } else {
      result.data.startDate = startDate
    }
  }

  if (fields.endDate !== undefined) {
    if (fields.endDate === null) {
      result.data.endDate = null
    } else {
      const endDate = parseDate(fields.endDate)
      if (!endDate) {
        result.errors.push('invalid_end_date')
      } else {
        result.data.endDate = endDate
      }
    }
  }
  // endDate before startDate is rejected in the route, where both values are known together.

  if (fields.locationName !== undefined || !partial) {
    const locationName = fields.locationName
    if (typeof locationName !== 'string' || locationName.trim().length === 0 || locationName.length > LOCATION_MAX) {
      result.errors.push('invalid_location')
    } else {
      result.data.locationName = locationName.trim()
    }
  }

  if (fields.street !== undefined) {
    const street = fields.street
    if (street !== null && (typeof street !== 'string' || street.length > STREET_MAX)) {
      result.errors.push('invalid_street')
    } else {
      result.data.street = street
    }
  }

  if (fields.postalCode !== undefined || !partial) {
    const postalCode = fields.postalCode
    if (typeof postalCode !== 'string' || postalCode.trim().length === 0 || postalCode.length > POSTAL_CODE_MAX) {
      result.errors.push('invalid_postal_code')
    } else {
      result.data.postalCode = postalCode.trim()
    }
  }

  if (fields.city !== undefined || !partial) {
    const city = fields.city
    if (typeof city !== 'string' || city.trim().length === 0 || city.length > CITY_MAX) {
      result.errors.push('invalid_city')
    } else {
      result.data.city = city.trim()
    }
  }

  if (fields.state !== undefined || !partial) {
    const state = fields.state
    if (typeof state !== 'string' || state.trim().length === 0 || state.length > STATE_MAX) {
      result.errors.push('invalid_state')
    } else {
      result.data.state = state.trim()
    }
  }

  if (fields.country !== undefined || !partial) {
    const country = fields.country
    if (typeof country !== 'string' || !COUNTRIES.includes(country)) {
      result.errors.push('invalid_country')
    } else {
      result.data.country = country as Country
    }
  }

  for (const key of ['latitude', 'longitude'] as const) {
    if (fields[key] !== undefined || !partial) {
      const value = fields[key]
      const limit = key === 'latitude' ? 90 : 180
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
        result.errors.push(key === 'latitude' ? 'invalid_latitude' : 'invalid_longitude')
      } else {
        result.data[key] = value
      }
    }
  }

  if (fields.entryFeeCent !== undefined) {
    const value = fields.entryFeeCent
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > FEE_MAX) {
      result.errors.push('invalid_entry_fee')
    } else {
      result.data.entryFeeCent = value
    }
  }

  if (fields.currency !== undefined || !partial) {
    const currency = fields.currency
    if (typeof currency !== 'string' || !CURRENCIES.includes(currency)) {
      result.errors.push('invalid_currency')
    } else {
      result.data.currency = currency
    }
  }

  if (fields.isRecurring !== undefined) {
    if (typeof fields.isRecurring !== 'boolean') {
      result.errors.push('invalid_boolean')
    } else {
      result.data.isRecurring = fields.isRecurring
    }
  }

  if (fields.rankedEligible !== undefined) {
    if (typeof fields.rankedEligible !== 'boolean') {
      result.errors.push('invalid_boolean')
    } else {
      result.data.rankedEligible = fields.rankedEligible
    }
  }

  if (fields.recurringDays !== undefined) {
    if (fields.recurringDays === null) {
      result.data.recurringDays = null
    } else {
      const value = fields.recurringDays
      if (typeof value !== 'number' || !Number.isInteger(value) || value < RECURRING_DAYS_MIN || value > RECURRING_DAYS_MAX) {
        result.errors.push('invalid_recurring_days')
      } else {
        result.data.recurringDays = value
      }
    }
  }

  if (fields.rulesetId !== undefined || !partial) {
    const rulesetId = fields.rulesetId
    if (typeof rulesetId !== 'string' || rulesetId.length === 0) {
      result.errors.push('invalid_ruleset')
    } else {
      result.data.rulesetId = rulesetId
    }
  }

  // clubId is POST-only (a tournament's club never changes after creation — the PATCH route
  // never reads it). null means "no club"; a string must be non-empty.
  if (!partial && fields.clubId !== undefined) {
    const clubId = fields.clubId
    if (clubId !== null && (typeof clubId !== 'string' || clubId.length === 0)) {
      result.errors.push('invalid_club')
    } else {
      result.data.clubId = clubId
    }
  }

  if (partial && Object.keys(result.data).length === 0) {
    result.errors.push('no_fields')
  }
  return result
}
