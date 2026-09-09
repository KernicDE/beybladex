// tests/unit/currency.test.ts
// Phase 5 Part B: exact conversion math against a FIXED fake rate table (never live rates —
// the pure half of lib/currency.ts has no network/Redis/clock) plus the ECB XML parser
// against a frozen payload of the verified feed shape.
import { describe, it, expect } from 'vitest'
import { convert, parseEcbRates } from '@/lib/currency'

// EUR-based fake table: 1 EUR = 2 USD = 1.5 CHF.
const TABLE = { EUR: 1, USD: 2, CHF: 1.5 }

describe('convert — exact math against a fixed rate table', () => {
  it('converts EUR → CHF exactly', () => {
    expect(convert(1000, 'EUR', 'CHF', TABLE)).toBe(1500)
  })

  it('converts CHF → EUR with cent rounding', () => {
    // 1000ct / 1.5 = 666.67ct → 667ct
    expect(convert(1000, 'CHF', 'EUR', TABLE)).toBe(667)
  })

  it('converts USD → CHF across two non-EUR currencies', () => {
    // 1000ct USD = 500ct EUR = 750ct CHF
    expect(convert(1000, 'USD', 'CHF', TABLE)).toBe(750)
  })

  it('is the identity for same-currency conversions', () => {
    expect(convert(1234, 'EUR', 'EUR', TABLE)).toBe(1234)
    expect(convert(1234, 'CHF', 'CHF', TABLE)).toBe(1234)
  })

  it('treats absent EUR as rate 1 (the ECB feed omits EUR)', () => {
    const usdOnly = { USD: 2 }
    expect(convert(1000, 'EUR', 'USD', usdOnly)).toBe(2000)
    expect(convert(1000, 'USD', 'EUR', usdOnly)).toBe(500)
  })

  it('rounds to the nearest whole cent', () => {
    expect(convert(10, 'EUR', 'CHF', { CHF: 1.25 })).toBe(13) // 12.5 → 13
    expect(convert(1, 'EUR', 'CHF', { CHF: 1.5 })).toBe(2) // 1.5 → 2
  })

  it('throws on non-positive or missing rates rather than returning NaN/Infinity', () => {
    expect(() => convert(100, 'USD', 'CHF', { USD: 0 })).toThrow(RangeError)
    expect(() => convert(100, 'USD', 'CHF', { USD: -2 })).toThrow(RangeError)
    expect(() => convert(100, 'USD', 'CHF', { USD: 2 })).toThrow(RangeError) // CHF missing
  })

  it('does not mutate the rate table', () => {
    const table = { ...TABLE }
    convert(1000, 'EUR', 'CHF', table)
    expect(table).toEqual(TABLE)
  })
})

// Frozen excerpt of the real ECB daily feed (shape verified against
// https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml on 2026-09-09).
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-09-08'>
      <Cube currency='USD' rate='1.1614'/>
      <Cube currency='JPY' rate='179.20'/>
      <Cube currency='CHF' rate='0.9425'/>
      <Cube currency='GBP' rate='0.85740'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

describe('parseEcbRates — frozen feed payload', () => {
  it('parses rates and normalises EUR to 1', () => {
    expect(parseEcbRates(ECB_XML)).toEqual({ EUR: 1, USD: 1.1614, JPY: 179.2, CHF: 0.9425, GBP: 0.8574 })
  })

  it('round-trips: converting with the parsed table is cent-exact', () => {
    const rates = parseEcbRates(ECB_XML)
    // 1 EUR → CHF at the frozen rate.
    expect(convert(100, 'EUR', 'CHF', rates)).toBe(94)
    // And back: 94.25ct EUR → USD.
    expect(convert(9425, 'EUR', 'USD', rates)).toBe(10946) // 9425 * 1.1614 = 10946.195
  })

  it('throws when the payload contains no rate cubes', () => {
    expect(() => parseEcbRates('<html><body>Service unavailable</body></html>')).toThrow()
  })
})
