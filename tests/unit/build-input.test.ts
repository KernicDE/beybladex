// tests/unit/build-input.test.ts (RC16, issue #122)
// verifyBuildParts: die DB-seitigen Bauform-Regeln des variablen Slot-Modells —
// Slot-Kategorien über alle 7 Slots, Ratchet-Regel am Blade-Teil (isRatchetIntegrated),
// comboWhere als NULL-sicherer Dedup-Key. Pure unit tests mit einem gefälschten Prisma-Seam,
// kein echtes DB.
import { describe, it, expect } from 'vitest'
import { verifyBuildParts, comboWhere, type BuildInput } from '@/lib/buildInput'
import { parseBuildProposalPayload } from '@/lib/proposalValidation'

type PartRow = { id: string; category: string; name: string; isRatchetIntegrated: boolean }

function fakePrisma(rows: PartRow[]) {
  return {
    part: {
      findMany: async () => rows,
    },
  }
}

const std = (over: Partial<BuildInput> = {}): BuildInput => ({
  bladeId: 'blade-1',
  lockChipId: null,
  overBladeId: null,
  metalBladeId: null,
  assistBladeId: null,
  ratchetId: 'ratchet-1',
  bitId: 'bit-1',
  type: null,
  name: null,
  productCode: null,
  ...over,
})

const PARTS: PartRow[] = [
  { id: 'blade-1', category: 'BLADE', name: 'DranSword 3-60', isRatchetIntegrated: false },
  { id: 'blade-integrated', category: 'BLADE', name: 'Valor Bison FB', isRatchetIntegrated: true },
  { id: 'ratchet-1', category: 'RATCHET', name: '3-60', isRatchetIntegrated: false },
  { id: 'bit-1', category: 'BIT', name: 'Flat', isRatchetIntegrated: false },
  { id: 'chip-1', category: 'LOCK_CHIP', name: 'Hurricane Enlil', isRatchetIntegrated: false },
  { id: 'over-1', category: 'OVER_BLADE', name: 'Hurricane', isRatchetIntegrated: false },
  { id: 'metal-1', category: 'METAL_BLADE', name: 'Enlil', isRatchetIntegrated: false },
  { id: 'assist-1', category: 'ASSIST_BLADE', name: 'Sword', isRatchetIntegrated: false },
]

describe('verifyBuildParts (RC16 #122)', () => {
  it('Standard-Trio verifiziert; Namen und Flag stehen in der Parts-Map', async () => {
    const result = await verifyBuildParts(fakePrisma(PARTS), std())
    expect('parts' in result).toBe(true)
    if ('parts' in result) {
      expect(result.parts.get('blade-1')!.name).toBe('DranSword 3-60')
      expect(result.parts.get('blade-1')!.isRatchetIntegrated).toBe(false)
    }
  })

  it('Ratchet-Integrated: Blade ohne Ratchet gültig; eigenes Ratchet abgelehnt', async () => {
    const ok = await verifyBuildParts(fakePrisma(PARTS), std({ bladeId: 'blade-integrated', ratchetId: null }))
    expect(ok).toHaveProperty('parts')

    const withRatchet = await verifyBuildParts(fakePrisma(PARTS), std({ bladeId: 'blade-integrated' }))
    expect(withRatchet).toEqual({ error: 'ratchet_not_allowed' })
  })

  it('Standard-Blade OHNE Ratchet → ratchet_required', async () => {
    const result = await verifyBuildParts(fakePrisma(PARTS), std({ ratchetId: null }))
    expect(result).toEqual({ error: 'ratchet_required' })
  })

  it('Custom Line: kompletter 6er-Stack verifiziert; falsche CX-Kategorie benannt', async () => {
    const cx = std({
      bladeId: null,
      lockChipId: 'chip-1',
      overBladeId: 'over-1',
      metalBladeId: 'metal-1',
      assistBladeId: 'assist-1',
    })
    const ok = await verifyBuildParts(fakePrisma(PARTS), cx)
    expect(ok).toHaveProperty('parts')

    const wrong = await verifyBuildParts(fakePrisma(PARTS), { ...cx, metalBladeId: 'bit-1' })
    expect(wrong).toEqual({ error: 'invalid_metalBladeId' })
  })

  it('unbekannte Teil-Ids → unknown_<slot>', async () => {
    const result = await verifyBuildParts(fakePrisma(PARTS), std({ ratchetId: 'ratchet-ghost' }))
    expect(result).toEqual({ error: 'unknown_ratchetId' })
  })
})

describe('comboWhere (RC16 #122)', () => {
  it('hält alle 7 Slots mit Null-Semantik — der NULL-sichere Dedup-Key', () => {
    expect(comboWhere(std())).toEqual({
      bladeId: 'blade-1',
      lockChipId: null,
      overBladeId: null,
      metalBladeId: null,
      assistBladeId: null,
      ratchetId: 'ratchet-1',
      bitId: 'bit-1',
    })
    expect(comboWhere(std({ bladeId: 'blade-integrated', ratchetId: null }))).toMatchObject({
      bladeId: 'blade-integrated',
      ratchetId: null,
    })
  })
})

describe('parseBuildProposalPayload (RC16 #122)', () => {
  const inline = { name: 'X', manufacturer: 'HASBRO', beyType: null, spinDirection: 'RIGHT', weightGrams: null }

  it('Standard-Payload (blade + ratchet + bit) unverändert gültig', () => {
    const parsed = parseBuildProposalPayload({
      name: 'Test Set',
      slots: { blade: { partId: 'b' }, ratchet: { partId: 'r' }, bit: { partId: 't' } },
    })
    expect(parsed.errors).toBeUndefined()
    expect(parsed.data!.slots.blade.partId).toBe('b')
    expect(parsed.data!.slots.ratchet.partId).toBe('r')
  })

  it('ratchet-Slot darf leer bleiben (Ratchet-Integrated-Entscheidung fällt am Approval)', () => {
    const parsed = parseBuildProposalPayload({
      name: 'Valor Bison FB Set',
      slots: { blade: { partId: 'b' }, bit: { partId: 't' } },
    })
    expect(parsed.errors).toBeUndefined()
    expect(parsed.data!.slots.ratchet).toEqual({ partId: null, inline: null })
  })

  it('CX: alle vier Slots gemeinsam gültig; Teil-Stack benennt die fehlenden Slots', () => {
    const full = parseBuildProposalPayload({
      name: 'Hurricane Enlil CX',
      slots: {
        lockChip: { partId: 'lc' },
        overBlade: { inline },
        metalBlade: { partId: 'mb' },
        assistBlade: { partId: 'ab' },
        ratchet: { partId: 'r' },
        bit: { partId: 't' },
      },
    })
    expect(full.errors).toBeUndefined()
    expect(full.data!.slots.lockChip!.partId).toBe('lc')

    const partial = parseBuildProposalPayload({
      name: 'CX unvollständig',
      slots: { lockChip: { partId: 'lc' }, overBlade: { partId: 'ob' }, ratchet: { partId: 'r' }, bit: { partId: 't' } },
    })
    expect(partial.errors).toEqual(['invalid_slot_metalBlade', 'invalid_slot_assistBlade'])
  })

  it('blade UND CX-Stack zusammen ist keine gültige Bauform', () => {
    const parsed = parseBuildProposalPayload({
      name: 'Widerspruch',
      slots: {
        blade: { partId: 'b' },
        lockChip: { partId: 'lc' },
        overBlade: { partId: 'ob' },
        metalBlade: { partId: 'mb' },
        assistBlade: { partId: 'ab' },
        ratchet: { partId: 'r' },
        bit: { partId: 't' },
      },
    })
    expect(parsed.errors).toEqual(['invalid_slot_blade'])
  })
})
