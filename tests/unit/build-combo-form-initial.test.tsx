// tests/unit/build-combo-form-initial.test.tsx (#164)
// BuildComboForm.initial — "Teile ändern" auf der Build-Detailseite (BuildPartsEditor) startet
// vorbelegt mit den aktuellen Teilen/dem aktuellen Typ, statt bei drei leeren Slots.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BuildComboForm } from '@/components/beyblade/BuildComboForm'

describe('BuildComboForm mit initial (#164)', () => {
  it('zeigt die vorbelegten Teile direkt an (kein leerer Slot-Picker)', () => {
    render(
      <BuildComboForm
        onCreated={vi.fn()}
        initial={{
          blade: { id: 'p-blade', name: 'Dranzer' },
          ratchet: { id: 'p-ratchet', name: '4-60' },
          bit: { id: 'p-bit', name: 'Flat' },
          type: 'ATTACK',
        }}
      />,
    )
    expect(screen.getByText('Dranzer')).toBeInTheDocument()
    expect(screen.getByText('4-60')).toBeInTheDocument()
    expect(screen.getByText('Flat')).toBeInTheDocument()
    // Jeder vorbelegte Slot zeigt "Ändern" statt der Such-Eingabe.
    expect(screen.getAllByRole('button', { name: 'Ändern' })).toHaveLength(3)
  })

  it('ohne initial startet mit drei leeren, suchbaren Slots', () => {
    render(<BuildComboForm onCreated={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Ändern' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Blade-Name…')).toBeInTheDocument()
  })
})
