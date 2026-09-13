// tests/unit/beyblade-input.test.ts (MVP4, #141)
// parseBeybladeInput: der Curator-Pfad für offizielle Sets — name required, manufacturer
// Pflicht-Enum, productCode optional, dieselben 7 Assembly-Slots mit derselben strukturellen
// Blade-Assembly-Regel wie Builds (lib/assembly.ts — DIE Regel-Stelle).
import { describe, it, expect } from 'vitest'
import { parseBeybladeInput } from '@/lib/beybladeInput'

const STD = {
  name: 'Sword Dran 3-60F',
  manufacturer: 'TT',
  productCode: 'BX-01',
  bladeId: 'b',
  ratchetId: 'r',
  bitId: 't',
}

describe('parseBeybladeInput (MVP4 #141)', () => {
  it('Standard-Set (blade + ratchet + bit) parsed vollständig', () => {
    const { data, errors } = parseBeybladeInput(STD)
    expect(errors).toBeUndefined()
    expect(data).toMatchObject({
      name: 'Sword Dran 3-60F',
      manufacturer: 'TT',
      productCode: 'BX-01',
      bladeId: 'b',
      ratchetId: 'r',
      bitId: 't',
      lockChipId: null,
      overBladeId: null,
      metalBladeId: null,
      assistBladeId: null,
    })
  })

  it('name fehlt → invalid_name (eine Beyblade ist ein Retail-Produkt mit Produktnamen)', () => {
    const { errors } = parseBeybladeInput({ ...STD, name: '' })
    expect(errors).toContain('invalid_name')
  })

  it('manufacturer ist Pflicht-Enum (TT|HASBRO)', () => {
    expect(parseBeybladeInput({ ...STD, manufacturer: 'SONY' }).errors).toContain('invalid_manufacturer')
    expect(parseBeybladeInput({ ...STD, manufacturer: 'HASBRO' }).data!.manufacturer).toBe('HASBRO')
  })

  it('productCode toleriert Abwesenheit (null) und leeren String', () => {
    const { data } = parseBeybladeInput({ name: STD.name, manufacturer: 'TT', bladeId: 'b', ratchetId: 'r', bitId: 't' })
    expect(data!.productCode).toBeNull()
  })

  it('Blade XOR CX-Stack: beides zusammen → invalid_bladeId; Teil-Stack benennt fehlende CX-Slots', () => {
    const both = parseBeybladeInput({ ...STD, lockChipId: 'lc' })
    expect(both.errors).toEqual(['invalid_bladeId'])

    const partial = parseBeybladeInput({
      name: STD.name,
      manufacturer: 'TT',
      lockChipId: 'lc',
      overBladeId: 'ob',
      ratchetId: 'r',
      bitId: 't',
    })
    expect(partial.errors).toEqual(['invalid_metalBladeId', 'invalid_assistBladeId'])
  })

  it('bitId ist in jeder Bauform Pflicht', () => {
    const { errors } = parseBeybladeInput({ ...STD, bitId: undefined })
    expect(errors).toContain('invalid_bitId')
  })
})
