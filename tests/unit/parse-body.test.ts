// tests/unit/parse-body.test.ts (RC4, issue #55)
// Unit coverage for lib/parseBody.ts and the six validators migrated onto it. The error
// tokens are API contract (route responses + integration tests assert them), so these tests
// pin the exact tokens and edge semantics (absent/required/nullable, fail-fast, coercion)
// the hand-rolled predecessors had. Runs locally, no DB.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseBody } from '@/lib/parseBody'
import { parsePartInput } from '@/lib/partValidation'
import { parseBuildInput } from '@/lib/buildInput'
import { parseCollectionItemBody } from '@/lib/collectionItemBody'
import { parseRulesetInput } from '@/lib/rulesetValidation'
import { parseTournamentInput } from '@/lib/tournamentValidation'
import { parsePartProposalPayload, parseBuildProposalPayload } from '@/lib/proposalValidation'

afterEach(() => vi.restoreAllMocks())

describe('parseBody engine', () => {
  it('rejects a non-object body with invalid_body', () => {
    for (const body of [null, undefined, 42, 'x', true]) {
      expect(parseBody(body, { a: { type: 'string' } }, { partial: false }).errors).toEqual(['invalid_body'])
    }
  })

  it('warns about unknown fields but still extracts the known ones (whitelist never rejects)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = parseBody(
      { name: 'Dranzer', legacyImageUrl: 'http://x', other: 1 },
      { name: { type: 'string', trim: true, required: true } },
      { partial: false },
    )
    expect(result.errors).toEqual([])
    expect(result.data).toEqual({ name: 'Dranzer' })
    expect(result.unknown).toEqual(['legacyImageUrl', 'other'])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('legacyImageUrl')
  })

  it('POST: required fields error when absent; optional fields are skipped; absentNull stores null', () => {
    const schema = {
      req: { type: 'string' as const, required: true, token: 'invalid_req' },
      opt: { type: 'string' as const, token: 'invalid_opt' },
      nul: { type: 'string' as const, nullable: true, absentNull: true, token: 'invalid_nul' },
    }
    const result = parseBody({}, schema, { partial: false })
    expect(result.errors).toEqual(['invalid_req'])
    expect(result.data).toEqual({ nul: null })
  })

  it('PATCH (partial): absent fields are always skipped, present wrong types still error', () => {
    const schema = {
      req: { type: 'string' as const, required: true, token: 'invalid_req' },
      num: { type: 'integer' as const, token: 'invalid_num' },
    }
    expect(parseBody({}, schema, { partial: true })).toMatchObject({ errors: [], data: {} })
    expect(parseBody({ req: 'ok', num: 1.5 }, schema, { partial: true }).errors).toEqual(['invalid_num'])
  })

  it('explicit null errors unless the field is nullable', () => {
    const schema = {
      a: { type: 'string' as const, required: true, token: 'invalid_a' },
      b: { type: 'string' as const, nullable: true, token: 'invalid_b' },
    }
    const result = parseBody({ a: null, b: null }, schema, { partial: false })
    expect(result.errors).toEqual(['invalid_a'])
    expect(result.data).toEqual({ b: null })
  })

  it('maxError rejects oversize raw input; the default caps after trimming', () => {
    const schema = {
      strict: { type: 'string' as const, trim: true, maxLength: 5, maxError: true, token: 'invalid_strict' },
      capped: { type: 'string' as const, trim: true, maxLength: 5, token: 'invalid_capped' },
    }
    expect(parseBody({ strict: '123456' }, schema, { partial: false }).errors).toEqual(['invalid_strict'])
    const ok = parseBody({ capped: '  123456  ' }, schema, { partial: false })
    expect(ok.errors).toEqual([])
    expect(ok.data.capped).toBe('12345')
  })

  it('coerce parses numeric strings; garbage still errors', () => {
    const schema = { price: { type: 'number' as const, min: 0, coerce: true, token: 'invalid_price' } }
    expect(parseBody({ price: '12.5' }, schema, { partial: true }).data.price).toBe(12.5)
    expect(parseBody({ price: { nope: true } }, schema, { partial: true }).errors).toEqual(['invalid_price'])
  })
})

describe('parsePartInput (malformed → exact tokens)', () => {
  const VALID = {
    name: 'TestBlade 1-60', manufacturer: 'TT', category: 'BLADE',
    beyType: 'ATTACK', spinDirection: 'RIGHT', weightGrams: 32.5, metadata: null,
  }

  it('POST accepts the full shape', () => {
    const { data, errors } = parsePartInput(VALID, false)
    expect(errors).toBeUndefined()
    expect(data).toEqual(VALID)
  })

  it('POST rejects absence of every field (historical full-shape POST)', () => {
    const { errors } = parsePartInput({}, false)
    expect(errors).toEqual([
      'invalid_name', 'invalid_manufacturer', 'invalid_category', 'invalid_beyType',
      'invalid_spinDirection', 'invalid_weightGrams', 'invalid_metadata',
    ])
  })

  it('POST/PATCH keep exact per-field tokens', () => {
    expect(parsePartInput({ ...VALID, manufacturer: 'BANDAI' }, false).errors).toEqual(['invalid_manufacturer'])
    expect(parsePartInput({ ...VALID, weightGrams: 0 }, false).errors).toEqual(['invalid_weightGrams'])
    expect(parsePartInput({ ...VALID, weightGrams: 1000 }, false).errors).toEqual(['invalid_weightGrams'])
    expect(parsePartInput({ ...VALID, name: '   ' }, false).errors).toEqual(['invalid_name'])
    expect(parsePartInput({ ...VALID, metadata: [1] }, false).errors).toEqual(['invalid_metadata'])
    expect(parsePartInput({ category: 'BLADE' }, true).errors).toBeUndefined()
    expect(parsePartInput({ category: 'NOPE' }, true).errors).toEqual(['invalid_category'])
  })

  it('nullable fields accept explicit null; name caps by slicing, never errors on length', () => {
    const { data, errors } = parsePartInput({ ...VALID, beyType: null, weightGrams: null, name: 'x'.repeat(300) }, false)
    expect(errors).toBeUndefined()
    expect(data!.beyType).toBeNull()
    expect(data!.name).toHaveLength(120)
  })
})

describe('parseBuildInput', () => {
  it('requires the three slots; type/name tolerate absence as null', () => {
    expect(parseBuildInput({}, { official: false }).errors).toEqual(['invalid_bladeId', 'invalid_ratchetId', 'invalid_bitId'])
    const { data } = parseBuildInput({ bladeId: 'b', ratchetId: 'r', bitId: 't' }, { official: false })
    expect(data).toEqual({ bladeId: 'b', ratchetId: 'r', bitId: 't', type: null, name: null })
  })

  it('user combos never carry a name even when one is sent; official sets validate it', () => {
    const user = parseBuildInput({ bladeId: 'b', ratchetId: 'r', bitId: 't', name: 'Retail Box' }, { official: false })
    expect(user.data!.name).toBeNull()
    expect(parseBuildInput({ bladeId: 'b', ratchetId: 'r', bitId: 't', name: '  ' }, { official: true }).errors).toEqual(['invalid_name'])
    expect(parseBuildInput({ bladeId: 'b', ratchetId: 'r', bitId: 't', type: 'NOPE' }, { official: true }).errors).toEqual(['invalid_type'])
  })
})

describe('parseCollectionItemBody (fail-fast: first error only)', () => {
  it('POST without partId → invalid_partId; rounding + merchant whitespace → null preserved', () => {
    expect(parseCollectionItemBody({ purchasePrice: 1 }, { requirePart: true })).toEqual({ error: 'invalid_partId' })
    const { fields } = parseCollectionItemBody(
      { partId: 'p1', purchasePrice: 9.999, merchant: '   ', boughtAt: '2026-08-01', currency: 'EUR' },
      { requirePart: true },
    )
    expect(fields!.purchasePrice).toBe(10)
    expect(fields!.merchant).toBeNull()
    expect(fields!.boughtAt).toBeInstanceOf(Date)
  })

  it('keeps the historical numeric-string coercion and per-field tokens', () => {
    const { fields } = parseCollectionItemBody({ partId: 'p1', purchasePrice: '12.5' }, { requirePart: true })
    expect(fields!.purchasePrice).toBe(12.5)
    expect(parseCollectionItemBody({ partId: 'p1', currency: 'XXX' }, { requirePart: true }).error).toBe('invalid_currency')
    expect(parseCollectionItemBody({ partId: 'p1', boughtAt: 'not-a-date' }, { requirePart: true }).error).toBe('invalid_boughtAt')
    expect(parseCollectionItemBody({ partId: 'p1', purchasePrice: -1 }, { requirePart: true }).error).toBe('invalid_purchasePrice')
  })
})

describe('parseRulesetInput (tokens asserted by tests/integration/ruleset-crud.test.ts)', () => {
  it('pins invalid_deck_format / invalid_points / invalid_relaunch_limit / invalid_title', () => {
    expect(parseRulesetInput({ title: 'X', deckFormat: 'BOGUS' }, false).errors).toEqual(['invalid_deck_format'])
    expect(parseRulesetInput({ title: 'X', targetPoints: 0 }, false).errors).toEqual(['invalid_points'])
    expect(parseRulesetInput({ title: 'X', finalsTargetPoints: 101 }, false).errors).toEqual(['invalid_points'])
    expect(parseRulesetInput({ title: 'X', relaunchLimit: 11 }, false).errors).toEqual(['invalid_relaunch_limit'])
    expect(parseRulesetInput({}, false).errors).toEqual(['invalid_title'])
  })

  it('PATCH with no recognized fields → no_fields appended after field errors (historical order)', () => {
    expect(parseRulesetInput({ unknown: 1 }, true).errors).toEqual(['no_fields'])
    expect(parseRulesetInput({ lockedDecks: 'yes' }, true).errors).toEqual(['invalid_boolean', 'no_fields'])
  })
})

describe('parseTournamentInput', () => {
  const VALID = {
    title: 'Cup', startDate: '2026-10-01', locationName: 'Halle', postalCode: '12345',
    city: 'Berlin', state: 'BE', country: 'DE', latitude: 52.5, longitude: 13.4,
    currency: 'EUR', rulesetId: 'rs1',
  }

  it('POST requires the full core shape; PATCH skips absent fields', () => {
    expect(parseTournamentInput({}, false).errors).toEqual([
      'invalid_title', 'invalid_start_date', 'invalid_location', 'invalid_postal_code',
      'invalid_city', 'invalid_state', 'invalid_country', 'invalid_latitude',
      'invalid_longitude', 'invalid_currency', 'invalid_ruleset',
    ])
    expect(parseTournamentInput({ title: 'Neu' }, true)).toEqual({ data: { title: 'Neu' }, errors: [] })
    expect(parseTournamentInput({ unknown: 1 }, true).errors).toEqual(['no_fields'])
  })

  it('pins tokens: invalid_country / invalid_latitude / invalid_start_date / invalid_club', () => {
    expect(parseTournamentInput({ ...VALID, country: 'FR' }, false).errors).toEqual(['invalid_country'])
    expect(parseTournamentInput({ ...VALID, latitude: 91 }, false).errors).toEqual(['invalid_latitude'])
    expect(parseTournamentInput({ ...VALID, startDate: 'garbage' }, false).errors).toEqual(['invalid_start_date'])
    expect(parseTournamentInput({ ...VALID, clubId: 42 }, false).errors).toEqual(['invalid_club'])
    expect(parseTournamentInput({ ...VALID, clubId: null }, false).data.clubId).toBeNull()
  })

  it('clubId is POST-only: on PATCH it is an ignored unknown field (no error)', () => {
    expect(parseTournamentInput({ clubId: 'anything' }, true)).toEqual({ data: {}, errors: ['no_fields'] })
  })
})

describe('proposalValidation (prefixed inline-part tokens)', () => {
  const INLINE = { name: 'NewBlade', manufacturer: 'TT', spinDirection: 'RIGHT' }

  it('kind=PART: valid shape; wrong tokens pinned; notes tolerate garbage', () => {
    const ok = parsePartProposalPayload({ ...INLINE, category: 'BLADE', notes: 42 })
    expect(ok.errors).toBeUndefined()
    expect(ok.data).toMatchObject({ category: 'BLADE', notes: null, name: 'NewBlade' })
    expect(parsePartProposalPayload({ ...INLINE, category: 'NOPE' }).errors).toEqual(['invalid_category'])
    expect(parsePartProposalPayload({ ...INLINE, category: 'BLADE', manufacturer: 'X' }).errors).toEqual(['invalid_part_manufacturer'])
    expect(parsePartProposalPayload({ category: 'BLADE' }).errors).toEqual(
      expect.arrayContaining(['invalid_part_name', 'invalid_part_manufacturer', 'invalid_part_spinDirection']),
    )
  })

  it('kind=BUILD: slot union (partId XOR inline), prefixed slot tokens, invalid_slots', () => {
    const slots = {
      blade: { partId: 'p1' },
      ratchet: { inline: { ...INLINE, name: 'NewRatchet' } },
      bit: { partId: 'p2' },
    }
    const ok = parseBuildProposalPayload({ name: 'Set', slots })
    expect(ok.errors).toBeUndefined()
    expect(ok.data!.slots.blade).toEqual({ partId: 'p1', inline: null })
    expect(ok.data!.slots.ratchet.inline).toMatchObject({ name: 'NewRatchet' })

    expect(parseBuildProposalPayload({ name: 'Set' }).errors).toEqual(['invalid_slots'])
    expect(parseBuildProposalPayload({ name: 'Set', slots: { ...slots, blade: { bogus: 1 } } }).errors).toEqual(['invalid_slot_blade'])
    expect(
      parseBuildProposalPayload({ name: 'Set', slots: { ...slots, ratchet: { inline: { name: '', manufacturer: 'TT', spinDirection: 'RIGHT' } } } }).errors,
    ).toEqual(['invalid_slot_ratchet_name'])
  })
})
