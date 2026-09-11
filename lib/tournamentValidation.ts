// lib/tournamentValidation.ts (RC4 #55: schema-driven via lib/parseBody.ts)
// Whitelisted-field validation shared by POST /api/tournaments and PATCH /api/tournaments/[id].
// Every accepted field maps 1:1 to a Tournament column — no invented fields, no mass assignment:
// anything not listed in the schema is ignored (and warned about, see lib/parseBody.ts).
// `clubId` is accepted on POST as a validated string (null = no club); whether the caller may
// actually attach THAT club is the route's authz job (owner/admin ClubMember.isAdmin or a
// global ORGANIZER/ADMIN role).
import type { Country } from '@prisma/client'
import { parseBody, type BodySchema } from '@/lib/parseBody'
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
const CURRENCIES = ['EUR', 'CHF', 'USD'] as const
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
  // RC15 #12 — 3-vs-3 team mode; the route rejects flipping it once registrations exist.
  teamMode?: boolean
}

export type TournamentInput = {
  data: TournamentInputData
  errors: string[]
}

// POST-required columns carry `required` (absence errors on create); the rest are optional
// or nullable. clubId is POST-only (a tournament's club never changes after creation) — the
// PATCH parse passes the schema WITHOUT it, so a clubId key on PATCH is an ignored unknown.
const TOURNAMENT_SCHEMA: BodySchema = {
  title: { type: 'string', trim: true, maxLength: TITLE_MAX, maxError: true, required: true, token: 'invalid_title' },
  description: { type: 'string', maxLength: DESCRIPTION_MAX, maxError: true, nullable: true, token: 'invalid_description' },
  startDate: { type: 'date', required: true, token: 'invalid_start_date' },
  endDate: { type: 'date', nullable: true, token: 'invalid_end_date' },
  locationName: { type: 'string', trim: true, maxLength: LOCATION_MAX, maxError: true, required: true, token: 'invalid_location' },
  street: { type: 'string', maxLength: STREET_MAX, maxError: true, nullable: true, token: 'invalid_street' },
  postalCode: { type: 'string', trim: true, maxLength: POSTAL_CODE_MAX, maxError: true, required: true, token: 'invalid_postal_code' },
  city: { type: 'string', trim: true, maxLength: CITY_MAX, maxError: true, required: true, token: 'invalid_city' },
  state: { type: 'string', trim: true, maxLength: STATE_MAX, maxError: true, required: true, token: 'invalid_state' },
  country: { type: 'enum', enum: COUNTRIES, required: true, token: 'invalid_country' },
  latitude: { type: 'number', min: -90, max: 90, required: true, token: 'invalid_latitude' },
  longitude: { type: 'number', min: -180, max: 180, required: true, token: 'invalid_longitude' },
  entryFeeCent: { type: 'integer', min: 0, max: FEE_MAX, token: 'invalid_entry_fee' },
  currency: { type: 'enum', enum: CURRENCIES, required: true, token: 'invalid_currency' },
  isRecurring: { type: 'boolean', token: 'invalid_boolean' },
  rankedEligible: { type: 'boolean', token: 'invalid_boolean' },
  teamMode: { type: 'boolean', token: 'invalid_boolean' },
  recurringDays: { type: 'integer', min: RECURRING_DAYS_MIN, max: RECURRING_DAYS_MAX, nullable: true, token: 'invalid_recurring_days' },
  rulesetId: { type: 'string', minLength: 1, required: true, token: 'invalid_ruleset' },
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
  const schema: BodySchema = partial
    ? TOURNAMENT_SCHEMA
    : {
        ...TOURNAMENT_SCHEMA,
        // null means "no club"; a string must be non-empty (schema-level, authz is the route's).
        clubId: { type: 'string', minLength: 1, nullable: true, token: 'invalid_club' },
      }
  const { data, errors } = parseBody(body, schema, { partial })
  if (partial && Object.keys(data).length === 0) {
    errors.push('no_fields')
  }
  return { data: data as TournamentInputData, errors }
}
