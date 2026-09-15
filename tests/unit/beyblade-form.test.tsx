// tests/unit/beyblade-form.test.tsx (Issue #188)
// Curator direct-create form: submit is disabled until name + all three slots are picked, and
// POSTs the right shape to /api/admin/builds — the API route itself (POST /api/admin/builds)
// already has its own coverage; this pins the form/route CONTRACT (field names, JSON body).
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BeybladeForm } from '@/components/admin/BeybladeForm'

// Second param (`init`) is unused in the body but declared so `.mock.calls[n][1]` (the request
// body sent to /api/admin/builds) is typed as RequestInit below instead of `undefined`.
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit | undefined) => {
  void init
  const url = String(input)
  if (url.includes('/api/parts/search')) {
    return new Response(JSON.stringify({ parts: [{ id: 'p1', name: 'Dranzer', category: 'BLADE' }] }), { status: 200 })
  }
  return new Response(JSON.stringify({ id: 'bey1', existing: false }), { status: 201 })
})
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => fetchMock.mockClear())

describe('BeybladeForm (#188)', () => {
  it('Submit bleibt deaktiviert, bis Name + alle drei Slots gesetzt sind', async () => {
    render(<BeybladeForm onCreated={vi.fn()} />)
    const submit = screen.getByRole('button', { name: 'Set anlegen' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Set-Name'), { target: { value: 'Reaper Rhino C 4-55D' } })
    expect(submit).toBeDisabled() // noch keine Teile gewählt
  })

  it('POSTet die richtige Payload und ruft onCreated mit der Antwort auf', async () => {
    const onCreated = vi.fn()
    render(<BeybladeForm onCreated={onCreated} />)

    fireEvent.change(screen.getByLabelText('Set-Name'), { target: { value: 'Reaper Rhino C 4-55D' } })
    fireEvent.change(screen.getByPlaceholderText('z. B. G0290'), { target: { value: 'G0290' } })

    // Je einen Treffer pro Slot wählen (derselbe Mock-Treffer für alle drei Suchen) — scoped
    // auf den jeweiligen Slot-Container, sonst verschiebt sich der Index der "Suchen"-Buttons,
    // sobald ein vorheriger Slot zu "Ändern" kollabiert.
    for (const placeholder of ['Blade-Name…', 'Ratchet-Name…', 'Bit-Name…']) {
      const input = screen.getByPlaceholderText(placeholder)
      const slotContainer = input.closest('div.space-y-2') as HTMLElement
      fireEvent.change(input, { target: { value: 'Dran' } })
      fireEvent.click(within(slotContainer).getByRole('button', { name: 'Suchen' }))
      const chooseButton = await within(slotContainer).findByRole('button', { name: 'Wählen' })
      fireEvent.click(chooseButton)
    }

    const submit = screen.getByRole('button', { name: 'Set anlegen' })
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'bey1', existing: false }))

    const postCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/admin/builds')
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1]!.body as string)
    expect(body).toMatchObject({
      name: 'Reaper Rhino C 4-55D',
      manufacturer: 'TT',
      productCode: 'G0290',
      bladeId: 'p1',
      ratchetId: 'p1',
      bitId: 'p1',
    })
  })
})
