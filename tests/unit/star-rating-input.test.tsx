// tests/unit/star-rating-input.test.tsx (RC16 #107)
// Sterne-Eingabe als Hover-Widget: 5 native Radio-Inputs (role radiogroup — Pfeiltasten und
// Screenreader funktionieren), Klick setzt den Wert, Hover hebt eine Vorschau hervor.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StarRatingInput } from '@/components/beyblade/StarRatingInput'

describe('StarRatingInput (issue #107)', () => {
  it('rendert ein radiogroup mit 5 Radio-Inputs', () => {
    render(<StarRatingInput value={3} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Sterne' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(5)
  })

  it('markiert den gewählten Wert als checked', () => {
    render(<StarRatingInput value={4} onChange={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, false, false, true, false])
  })

  it('ruft onChange mit dem geklickten Stern auf', () => {
    const onChange = vi.fn()
    render(<StarRatingInput value={2} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('radio')[4]!)
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('Hover hebt Sterne bis zur Hover-Position hervor und fällt beim Verlassen zurück', () => {
    render(<StarRatingInput value={1} onChange={() => {}} />)
    const labels = screen.getAllByRole('radio').map((r) => r.closest('label')!)
    fireEvent.mouseEnter(labels[2]!)
    expect(labels[0]!.querySelector('span[aria-hidden]')!).toHaveClass('text-type-stamina')
    expect(labels[2]!.querySelector('span[aria-hidden]')!).toHaveClass('text-type-stamina')
    expect(labels[3]!.querySelector('span[aria-hidden]')!).toHaveClass('text-current/30')
    fireEvent.mouseLeave(screen.getByRole('radiogroup'))
    expect(labels[0]!.querySelector('span[aria-hidden]')!).toHaveClass('text-type-stamina')
    expect(labels[1]!.querySelector('span[aria-hidden]')!).toHaveClass('text-current/30')
  })

  it('jede Instanz bekommt eine eigene Radio-Gruppe (Edit + Neubewertung auf einer Seite)', () => {
    render(
      <>
        <StarRatingInput value={5} onChange={() => {}} />
        <StarRatingInput value={1} onChange={() => {}} />
      </>,
    )
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(10)
    expect(radios[0]!.name).not.toBe(radios[5]!.name)
  })
})
