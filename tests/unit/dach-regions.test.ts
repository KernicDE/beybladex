// tests/unit/dach-regions.test.ts
// Phase 9: the canonical DACH region list is complete (16 DE + 9 AT + 26 CH = 51), its
// codes/names are unique, and Nominatim-style raw strings resolve to canonical names.
import { describe, it, expect } from 'vitest'
import { canonicalRegionName, DACH_REGIONS, matchDachRegion, normalizeRegionName } from '@/lib/dachRegions'

describe('DACH_REGIONS — canonical completeness', () => {
  it('lists exactly 16 German Bundesländer, 9 Austrian, 26 Swiss cantons', () => {
    expect(DACH_REGIONS.DE).toHaveLength(16)
    expect(DACH_REGIONS.AT).toHaveLength(9)
    expect(DACH_REGIONS.CH).toHaveLength(26)
  })

  it('has unique codes and names within every country', () => {
    for (const regions of Object.values(DACH_REGIONS)) {
      expect(new Set(regions.map((r) => r.code)).size).toBe(regions.length)
      expect(new Set(regions.map((r) => r.name)).size).toBe(regions.length)
    }
  })

  it('uses official ISO-3166-2 codes without the country prefix', () => {
    expect(DACH_REGIONS.DE.map((r) => r.code).sort()).toEqual(
      ['BB', 'BE', 'BW', 'BY', 'HB', 'HE', 'HH', 'MV', 'NI', 'NW', 'RP', 'SH', 'SL', 'SN', 'ST', 'TH'].sort(),
    )
    expect(DACH_REGIONS.AT.map((r) => r.code).sort()).toEqual(['B', 'K', 'N', 'O', 'S', 'St', 'T', 'V', 'W'].sort())
    expect(DACH_REGIONS.CH.map((r) => r.code).sort()).toEqual(
      ['AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'].sort(),
    )
  })
})

describe('canonicalRegionName — Nominatim raw strings to canonical names', () => {
  it('matches exact canonical names case-insensitively', () => {
    expect(canonicalRegionName('DE', 'Bayern')).toBe('Bayern')
    expect(canonicalRegionName('DE', ' nordrhein-westfalen ')).toBe('Nordrhein-Westfalen')
    expect(canonicalRegionName('AT', 'Oberösterreich')).toBe('Oberösterreich')
    expect(canonicalRegionName('CH', 'Zürich')).toBe('Zürich')
  })

  it('matches the Swiss "Kanton <name>" prefix form', () => {
    expect(canonicalRegionName('CH', 'Kanton Zürich')).toBe('Zürich')
    expect(canonicalRegionName('CH', 'Kanton   Bern')).toBe('Bern')
  })

  it('matches registered aliases (e.g. French/Italian/Grison spellings)', () => {
    expect(canonicalRegionName('CH', 'Waadt')).toBe('Waadt')
    expect(canonicalRegionName('CH', 'Vaud')).toBe('Waadt')
    expect(canonicalRegionName('CH', 'Graubünden')).toBe('Graubünden')
    expect(canonicalRegionName('CH', 'Grisons')).toBe('Graubünden')
    expect(canonicalRegionName('AT', 'Wien')).toBe('Wien')
  })

  it('returns null for unknown regions and empty input', () => {
    expect(canonicalRegionName('DE', 'Atlantis')).toBeNull()
    expect(canonicalRegionName('DE', '')).toBeNull()
    expect(canonicalRegionName('DE', null)).toBeNull()
    expect(canonicalRegionName('CH', 'Bayern')).toBeNull() // right name, wrong country
  })

  it('matchDachRegion returns the full entry including code', () => {
    expect(matchDachRegion('DE', 'Freistaat Bayern')?.code).toBe('BY')
    expect(matchDachRegion('CH', 'Ticino')?.code).toBe('TI')
  })
})

describe('normalizeRegionName', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeRegionName('  Nordrhein   Westfalen ')).toBe('nordrhein westfalen')
    expect(normalizeRegionName('Kanton\nZürich')).toBe('kanton zürich')
  })
})
