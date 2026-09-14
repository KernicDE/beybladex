// tests/unit/deck-builder-save-feedback.test.tsx (#164)
// "Deck speichern" gab bisher gar kein Erfolgs-Feedback (nur Fehler waren sichtbar) — Live-
// Report. Deckt beide Richtungen ab: Erfolg zeigt "Gespeichert.", Fehler zeigt weiterhin die
// Fehlermeldung und NICHT "Gespeichert.".
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeckBuilder } from '@/components/beyblade/DeckBuilder'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('DeckBuilder — Speichern-Feedback (#164)', () => {
  it('zeigt "Gespeichert." nach erfolgreichem PATCH', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    render(<DeckBuilder deckId="d1" initialTitle="Mein Deck" initialBuilds={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deck speichern' }))

    await waitFor(() => expect(screen.getByText('Gespeichert.')).toBeInTheDocument())
  })

  it('zeigt bei einem Fehler die Fehlermeldung, NICHT "Gespeichert."', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    render(<DeckBuilder deckId="d1" initialTitle="Mein Deck" initialBuilds={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deck speichern' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByText('Gespeichert.')).not.toBeInTheDocument()
  })
})
