// tests/unit/build-parts-editor.test.tsx (#164)
// BuildPartsEditor — "Teile ändern" darf NIE den bestehenden Build mutieren (sonst passen
// dessen Bewertungen/Kommentare nicht mehr zur neuen Kombination). Bei einer geänderten
// Kombination legt POST /api/builds einen neuen (oder findet einen bestehenden) Build an; der
// Editor leitet dorthin weiter. Wird exakt dieselbe Kombination erneut bestätigt (server
// liefert dieselbe id zurück), schließt der Editor nur den Dialog — kein Redirect auf sich
// selbst.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BuildPartsEditor } from '@/components/beyblade/BuildPartsEditor'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }))

const fetchMock = vi.fn()

const INITIAL = {
  blade: { id: 'p-blade', name: 'Dranzer' },
  ratchet: { id: 'p-ratchet', name: '4-60' },
  bit: { id: 'p-bit', name: 'Flat' },
  type: 'ATTACK',
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  pushMock.mockReset()
})

describe('BuildPartsEditor (#164)', () => {
  it('leitet zum NEUEN Build weiter, wenn POST /api/builds eine andere id liefert', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ build: { id: 'new-build-id', type: 'ATTACK', name: null, blade: null, lockChip: null, overBlade: null, metalBlade: null, assistBlade: null, ratchet: null, bit: { id: 'p-bit', name: 'Flat' } } }),
    })
    render(<BuildPartsEditor currentBuildId="current-build-id" initial={INITIAL} />)

    fireEvent.click(screen.getByRole('button', { name: 'Teile ändern' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eigenen Build anlegen' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/builds/new-build-id'))
  })

  it('leitet NICHT weiter, wenn dieselbe Kombination (gleiche id) zurückkommt — schließt nur', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ build: { id: 'current-build-id', type: 'ATTACK', name: null, blade: null, lockChip: null, overBlade: null, metalBlade: null, assistBlade: null, ratchet: null, bit: { id: 'p-bit', name: 'Flat' } } }),
    })
    render(<BuildPartsEditor currentBuildId="current-build-id" initial={INITIAL} />)

    fireEvent.click(screen.getByRole('button', { name: 'Teile ändern' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eigenen Build anlegen' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(pushMock).not.toHaveBeenCalled()
    // Editor wieder eingeklappt.
    expect(screen.getByRole('button', { name: 'Teile ändern' })).toBeInTheDocument()
  })
})
