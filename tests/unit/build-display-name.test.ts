// tests/unit/build-display-name.test.ts (#164-Nachtrag)
// buildDisplayName — Live-Report mit Screenshot ("hier steht kein Name") auf /builds "Meine
// Builds": Build.name war bei Alt-Zeilen als leerer/nur-Leerzeichen-String statt NULL
// gespeichert. `??` fällt NUR bei null/undefined durch, nicht bei "" — die Titelzeile blieb
// leer statt auf den kanonischen Namen (Blade → Lock Chip → Bit) zurückzufallen.
import { describe, it, expect } from 'vitest'
import { buildDisplayName, type BuildCardData } from '@/components/beyblade/BuildCard'

function build(overrides: Partial<BuildCardData> = {}): BuildCardData {
  return {
    id: 'b1',
    type: 'ATTACK',
    blade: { id: 'p-blade', name: 'Dranzer' },
    bit: { id: 'p-bit', name: 'Flat' },
    ...overrides,
  }
}

describe('buildDisplayName (#164-Nachtrag)', () => {
  it('nutzt den kuratierten Namen, wenn gesetzt', () => {
    expect(buildDisplayName(build({ name: 'Mein Build' }))).toBe('Mein Build')
  })

  it('leerer String (Alt-Zeilen-Bug) fällt auf den kanonischen Namen zurück, statt leer zu bleiben', () => {
    expect(buildDisplayName(build({ name: '' }))).toBe('Dranzer')
  })

  it('nur-Leerzeichen-String fällt ebenfalls zurück', () => {
    expect(buildDisplayName(build({ name: '   ' }))).toBe('Dranzer')
  })

  it('null fällt zurück (unverändertes Verhalten)', () => {
    expect(buildDisplayName(build({ name: null }))).toBe('Dranzer')
  })

  it('Fallback-Kette: Blade → Lock Chip → Bit, wenn kein Name gesetzt ist', () => {
    expect(buildDisplayName(build({ name: null, blade: null, lockChip: { id: 'p-lc', name: 'Wizard' } }))).toBe('Wizard')
    expect(buildDisplayName(build({ name: null, blade: null }))).toBe('Flat') // Bit als letzter Fallback
  })
})
