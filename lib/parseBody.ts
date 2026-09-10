// lib/parseBody.ts (RC4, issue #55)
// One declarative request-body validator, replacing the six hand-rolled near-identical
// extraction loops (lib/partValidation.ts, lib/buildInput.ts, lib/collectionItemBody.ts,
// lib/rulesetValidation.ts, lib/tournamentValidation.ts, lib/proposalValidation.ts — ~600
// lines of duplicated `typeof x !== 'string'` plumbing). Deliberately NO new dependency
// (zod is only transitive here): the project's validation vocabulary is small and its error
// tokens are API contract — a hand-rolled engine keeps every token exactly stable.
//
// MODEL: a schema is a flat map of field specs. Each spec declares its type, constraints and
// the error token to emit on violation (default `invalid_<key>` — several validators share one
// token across fields, e.g. rulesetValidation's `invalid_points` for two keys, so the token is
// always explicit in the schema, never inferred).
//
// ABSENT/NULL SEMANTICS (the subtle part the old copies each got right in their own way):
//   - partial=false (POST): `required` fields are validated even when ABSENT (absence errors),
//     other fields are skipped when absent — unless `absentNull`, which stores an explicit null
//     (a NOT-NULL-with-JSON-default column reads "absent" as null in the old validators).
//   - partial=true (PATCH): absent fields are always skipped; a PRESENT field with a wrong
//     type is an error (never silently dropped).
//   - `nullable`: an explicit JSON null is accepted and stored as null.
//   - `lenient`: a present-but-wrong-typed value is coerced to null WITHOUT an error — only
//     used where the original validator tolerated garbage (proposal notes).
//
// UNKNOWN FIELDS: extraction warns (console.warn) about body keys not in the schema — the
// whitelisting itself is unchanged (unknown keys are still ignored, never rejected; several
// tests post superseded fields like imageUrl). Pass `warnUnknown: false` when parsing a
// SUBSET of a larger validated shape (e.g. an inline part inside a proposal payload) so the
// enclosing parse owns the warning.
export type FieldType = 'string' | 'enum' | 'number' | 'integer' | 'boolean' | 'date' | 'json'

export interface FieldSpec {
  type: FieldType
  /** Error token on violation. Default `invalid_<key>`; ALWAYS set it when several fields
   *  share one token in the old validator (e.g. 'invalid_points', 'invalid_boolean'). */
  token?: string
  enum?: readonly string[]
  /** Inclusive bounds. Use gt/lt for the exclusive variants. */
  min?: number
  max?: number
  gt?: number
  lt?: number
  /** Strings: trim before checks; empty-after-trim is an error — unless emptyNull, which
   *  stores null instead (requires nullable; the CollectionItem merchant degrades
   *  all-whitespace input to null rather than rejecting it). */
  trim?: boolean
  emptyNull?: boolean
  /** Strings: minimum raw length (before trim). */
  minLength?: number
  /** Strings/numbers: length/value cap. maxError turns an overflow into an ERROR, checked on
   *  the RAW string before trimming (the ruleset/tournament titles reject oversize input);
   *  the default CAPS by slicing AFTER the trim (part/merchant/proposal names always sliced). */
  maxLength?: number
  maxError?: boolean
  /** Numbers: accept numeric strings via Number() (collectionItemBody's purchasePrice
   *  historically coerced; anything non-string/non-number still errors). */
  coerce?: boolean
  /** POST: field is validated even when absent (absence → error). */
  required?: boolean
  /** Explicit JSON null is accepted → stored null. */
  nullable?: boolean
  /** POST: absent → stored null (column default). Ignored in partial mode. */
  absentNull?: boolean
  /** Present but wrong-typed → null, NO error (proposal notes tolerated anything). */
  lenient?: boolean
}

export type BodySchema = Record<string, FieldSpec>

export interface ParseBodyOptions {
  /** true = PATCH semantics (absent fields skipped). */
  partial: boolean
  /** false silences the unknown-field warning for sub-shape parses. Default true. */
  warnUnknown?: boolean
  /** true rejects Array bodies as invalid_body (proposalValidation's old isRecord). */
  rejectArrays?: boolean
}

export interface ParsedBody {
  /** Whitelisted, validated, coerced values (typed unknown — cast at the validator boundary,
   *  same as the old `data` objects). */
  data: Record<string, unknown>
  /** Every violation token, in schema order (old validators accumulated identically). */
  errors: string[]
  /** Body keys not present in the schema (warned about, never rejected). */
  unknown: string[]
}

function isRecord(v: unknown, rejectArrays: boolean): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(rejectArrays && Array.isArray(v))
}

export function parseBody(body: unknown, schema: BodySchema, opts: ParseBodyOptions): ParsedBody {
  const result: ParsedBody = { data: {}, errors: [], unknown: [] }
  if (!isRecord(body, opts.rejectArrays ?? false)) {
    result.errors.push('invalid_body')
    return result
  }

  for (const [key, spec] of Object.entries(schema)) {
    const token = spec.token ?? `invalid_${key}`
    const raw = body[key]

    if (raw === undefined) {
      if (opts.partial) continue
      if (spec.absentNull) {
        result.data[key] = null
        continue
      }
      if (spec.required) result.errors.push(token)
      continue
    }

    if (raw === null) {
      if (spec.nullable) {
        result.data[key] = null
        continue
      }
      result.errors.push(token)
      continue
    }

    switch (spec.type) {
      case 'string': {
        if (typeof raw !== 'string') {
          if (spec.lenient && spec.nullable) result.data[key] = null
          else result.errors.push(token)
          break
        }
        if (spec.minLength !== undefined && raw.length < spec.minLength) {
          result.errors.push(token)
          break
        }
        if (spec.maxLength !== undefined && spec.maxError && raw.length > spec.maxLength) {
          result.errors.push(token)
          break
        }
        let value = raw
        if (spec.trim) {
          value = value.trim()
          if (value.length === 0) {
            if (spec.emptyNull && spec.nullable) result.data[key] = null
            else result.errors.push(token)
            break
          }
        }
        if (spec.maxLength !== undefined && !spec.maxError && value.length > spec.maxLength) {
          value = value.slice(0, spec.maxLength)
        }
        result.data[key] = value
        break
      }
      case 'enum': {
        if (typeof raw !== 'string' || !spec.enum || !spec.enum.includes(raw)) {
          if (spec.lenient && spec.nullable) result.data[key] = null
          else result.errors.push(token)
          break
        }
        result.data[key] = raw
        break
      }
      case 'number':
      case 'integer': {
        let value: unknown = raw
        if (typeof value === 'string' && spec.coerce) value = Number(value)
        if (typeof value !== 'number' || !Number.isFinite(value) || (spec.type === 'integer' && !Number.isInteger(value))) {
          result.errors.push(token)
          break
        }
        if (spec.min !== undefined && value < spec.min) {
          result.errors.push(token)
          break
        }
        if (spec.max !== undefined && value > spec.max) {
          result.errors.push(token)
          break
        }
        if (spec.gt !== undefined && value <= spec.gt) {
          result.errors.push(token)
          break
        }
        if (spec.lt !== undefined && value >= spec.lt) {
          result.errors.push(token)
          break
        }
        result.data[key] = value
        break
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          result.errors.push(token)
          break
        }
        result.data[key] = raw
        break
      }
      case 'date': {
        if (typeof raw !== 'string' || raw.length === 0) {
          result.errors.push(token)
          break
        }
        const date = new Date(raw)
        if (Number.isNaN(date.getTime())) {
          result.errors.push(token)
          break
        }
        result.data[key] = date
        break
      }
      case 'json': {
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          result.errors.push(token)
          break
        }
        result.data[key] = raw
        break
      }
    }
  }

  if (opts.warnUnknown !== false) {
    const unknown = Object.keys(body).filter((k) => !(k in schema))
    if (unknown.length > 0) {
      console.warn(`[parseBody] ignoring unknown field(s): ${unknown.join(', ')}`)
      result.unknown = unknown
    }
  }
  return result
}
