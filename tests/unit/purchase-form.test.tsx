// tests/unit/purchase-form.test.tsx (MVP4 #142)
// Händler-Autocomplete im Kauf-Formular: Vorschläge werden erst ab 3 Zeichen von
// /api/merchants/suggest geholt (debounced) und als <datalist>-Optionen gerendert.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PurchaseForm } from '@/components/beyblade/PurchaseForm'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ merchants: ['Amazon.de', 'Amazon.fr'] }) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PurchaseForm — Händler-Autocomplete (#142)', () => {
  it('rendert die Kauf-Felder', () => {
    render(<PurchaseForm beybladeId="b1" />)
    expect(screen.getByText('Als gekauft markieren')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('z. B. Amazon.de')).toBeInTheDocument()
    expect(screen.getByText('Kaufdatum (optional)')).toBeInTheDocument()
    expect(screen.getByText('Kaufpreis (optional)')).toBeInTheDocument()
  })

  it('holt Vorschläge ab 3 Zeichen und rendert sie als datalist-Optionen', async () => {
    render(<PurchaseForm beybladeId="b1" />)
    const input = screen.getByPlaceholderText('z. B. Amazon.de')

    fireEvent.change(input, { target: { value: 'Ama' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/merchants/suggest?q=Ama')
    const datalist = document.querySelector('datalist')!
    expect(datalist).not.toBeNull()
    const options = Array.from(datalist.querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['Amazon.de', 'Amazon.fr'])
  })

  it('fragt bei weniger als 3 Zeichen nichts ab', async () => {
    render(<PurchaseForm beybladeId="b1" />)
    const input = screen.getByPlaceholderText('z. B. Amazon.de')

    fireEvent.change(input, { target: { value: 'Am' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('debounced: nur der letzte Stand wird abgefragt', async () => {
    render(<PurchaseForm beybladeId="b1" />)
    const input = screen.getByPlaceholderText('z. B. Amazon.de')

    fireEvent.change(input, { target: { value: 'Am' } })
    fireEvent.change(input, { target: { value: 'Ama' } })
    fireEvent.change(input, { target: { value: 'Amaz' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/merchants/suggest?q=Amaz')
  })
})
