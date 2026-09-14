// lib/tournamentValidation.ts (RC4 #55: schema-driven via lib/parseBody.ts)
// Whitelisted-field validation shared by POST /api/tournaments and PATCH /api/tournaments/[id].
// Every accepted field maps 1:1 to a Tournament column — no invented fields, no mass assignment:
// anything not listed in the schema is ignored (and warned about, see lib/parseBody.ts).
// `clubId` is accepted on POST as a validated string (null = no club); whether the caller may
// actually attach THAT club is the route's authz job (owner/admin ClubMember.isAdmin or a
// global ORGANIZER/ADMIN role).
import type { Country, TournamentKind } from '@prisma/client'
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
// Issue #176 — Event-Typen. Nicht als `required` im Schema: die Regel ("rulesetId nur bei
// BRACKET Pflicht") hängt von diesem Feld ab, und parseBody kennt kein "required, wenn Feld X =
// Y" — die eigentliche Pflicht wird unten in parseTournamentInput app-seitig durchgesetzt.
const KINDS: string[] = ['BRACKET', 'STAMMTISCH', 'FREEPLAY']

export type TournamentInputData = {
  title?: string
  description?: string | null
  startDate?: Date
  endDate?: Date | null
  deckLockAt?: Date | null
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
  // Issue #176 — Event-Typ; omitted defaults to BRACKET (DB-Default + bestehendes Verhalten).
  kind?: TournamentKind
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
  // Issue #181 — "Decklock": optionale Sperrfrist fürs Deck-Wählen/-Wechseln; nullable auf
  // POST UND PATCH (anders als kind, das nach dem Anlegen fix bleibt — die Sperrfrist darf ein
  // Veranstalter später anpassen, z. B. verlängern, wenn zu wenige Decks eingegangen sind).
  deckLockAt: { type: 'date', nullable: true, token: 'invalid_deck_lock_at' },
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
  // Issue #176 — NICHT mehr `required: true`: nur bei kind=BRACKET Pflicht, siehe
  // parseTournamentInput unten (parseBody kennt kein feldabhängiges "required").
  rulesetId: { type: 'string', minLength: 1, token: 'invalid_ruleset' },
}

// `partial = true` is PATCH semantics: every field optional, but a recognized field with a
// wrong type is an error (not silently dropped). `partial = false` is POST: the required
// columns must be present. Mirrors lib/rulesetValidation.ts.
//
// clubId (Phase 4): accepted on POST only when the caller may administer that club — the
// ROUTE verifies ClubMember.isAdmin (or an ORGANIZER/ADMIN role); this parser only validates
// the shape, never the authorization.
// Issue #176 — rulesetId ist im Rückgabetyp jetzt `string | undefined` statt garantiert
// `string`: es ist nur bei kind=BRACKET Pflicht (unten app-seitig durchgesetzt), bei
// STAMMTISCH/FREEPLAY bleibt es zulässigerweise leer.
export function parseTournamentInput(body: unknown, partial: false): TournamentInput & { data: TournamentInputData & { title: string; startDate: Date; locationName: string; postalCode: string; city: string; state: string; latitude: number; longitude: number; kind: TournamentKind } }
export function parseTournamentInput(body: unknown, partial: true): TournamentInput
export function parseTournamentInput(body: unknown, partial: boolean): TournamentInput {
  const schema: BodySchema = partial
    ? TOURNAMENT_SCHEMA
    : {
        ...TOURNAMENT_SCHEMA,
        // null means "no club"; a string must be non-empty (schema-level, authz is the route's).
        clubId: { type: 'string', minLength: 1, nullable: true, token: 'invalid_club' },
        // Issue #176 — POST-only wie clubId: der Event-Typ steht mit der Bracket-/Match-/Judge-
        // Infrastruktur in Beziehung, die an Kind hängt (Matches, Snapshots, ...) — ein
        // nachträglicher Wechsel könnte inkonsistente Zustände erzeugen (z. B. ein bereits mit
        // Matches laufendes BRACKET-Turnier zu STAMMTISCH heruntergestuft). Auf PATCH ist das
        // Feld daher ein ignoriertes Unknown, exakt wie clubId oben.
        kind: { type: 'enum', enum: KINDS, token: 'invalid_kind' },
      }
  const { data, errors } = parseBody(body, schema, { partial })
  if (partial && Object.keys(data).length === 0) {
    errors.push('no_fields')
  }
  const result = data as TournamentInputData
  if (!partial) {
    // POST: kind defaults to BRACKET (matches the DB default / bisheriges Verhalten für
    // Clients, die das Feld noch nicht kennen). rulesetId ist NUR bei BRACKET Pflicht — die
    // eigentliche Regel, die parseBody selbst nicht ausdrücken kann.
    result.kind = result.kind ?? 'BRACKET'
    if (result.kind === 'BRACKET' && !result.rulesetId) {
      errors.push('invalid_ruleset')
    }
    // Ranglisten-Wertung und Team-Modus ergeben bei einem reinen Termin ohne Bracket keinen
    // Sinn — server-seitig erzwungen, unabhängig davon, was der Client schickt.
    if (result.kind !== 'BRACKET') {
      result.rankedEligible = false
      result.teamMode = false
    }
  }
  return { data: result, errors }
}
