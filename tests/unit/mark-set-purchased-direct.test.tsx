// tests/unit/mark-set-purchased-direct.test.tsx (RC16 #103)
// Mit `beyblade`-Prop entfaellt die Set-Suche: die Komponente startet direkt mit dem
// ausgewaehlten Set und zeigt nur noch die Kauf-Felder (POST /api/collection/mark-set-purchased
// nimmt beybladeId direkt entgegen — die Suche war nie API-Zwang, nur UI; MVP4 #141).
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MarkSetPurchasedForm } from '@/components/collection/MarkSetPurchasedForm'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('MarkSetPurchasedForm mit vorgegebener Beyblade (issue #103, MVP4 #141)', () => {
  it('zeigt das Set direkt an und keinen Such-Picker', () => {
    render(<MarkSetPurchasedForm beyblade={{ id: 'b1', name: 'Sword Dran 3-60F' }} />)
    expect(screen.getByText('Set:')).toBeInTheDocument()
    expect(screen.getByText('Sword Dran 3-60F')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Set-Name/)).not.toBeInTheDocument()
    // Die Kauf-Felder sind sofort da.
    expect(screen.getByText('Als gekauft markieren')).toBeInTheDocument()
  })

  it('bietet ohne beyblade-Prop weiterhin die Suche an', () => {
    render(<MarkSetPurchasedForm />)
    expect(screen.getByPlaceholderText(/Set-Name/)).toBeInTheDocument()
  })
})
