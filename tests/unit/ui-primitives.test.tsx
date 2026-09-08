// tests/unit/ui-primitives.test.tsx
// Each Task 13 primitive renders with its documented states. These are deliberately
// behavioral checks (roles/attributes/state), not snapshot tests — the visual layer
// is Tailwind tokens, the contract is accessibility + composition.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Card, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ToastProvider, useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField } from '@/components/ui/FormField'
import { SearchInput } from '@/components/ui/SearchInput'

describe('Button', () => {
  it('renders a labeled button', () => {
    render(<Button>Speichern</Button>)
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('is disabled in the disabled state', () => {
    render(<Button disabled>Speichern</Button>)
    const btn = screen.getByRole('button', { name: 'Speichern' })
    expect(btn).toBeDisabled()
    expect(btn.className).toContain('disabled:opacity-50')
  })

  it('exposes variants via class tokens', () => {
    render(<Button variant="danger">Löschen</Button>)
    expect(screen.getByRole('button', { name: 'Löschen' }).className).toContain('bg-type-attack')
  })
})

describe('Input', () => {
  it('renders an input and reflects the error state', () => {
    render(<Input aria-label="Benutzername" invalid />)
    const input = screen.getByRole('textbox', { name: 'Benutzername' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.className).toContain('border-type-attack')
  })

  it('renders disabled', () => {
    render(<Input aria-label="Feld" disabled />)
    expect(screen.getByRole('textbox', { name: 'Feld' })).toBeDisabled()
  })
})

describe('Select', () => {
  it('renders its options', () => {
    render(
      <Select aria-label="Land">
        <option value="de">Deutschland</option>
        <option value="at">Österreich</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Land' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Österreich' })).toBeInTheDocument()
  })
})

describe('Textarea', () => {
  it('renders and reflects the error state', () => {
    render(<Textarea aria-label="Bio" invalid />)
    const ta = screen.getByRole('textbox', { name: 'Bio' })
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Card', () => {
  it('renders title and content', () => {
    render(
      <Card>
        <CardTitle>Titel</CardTitle>
        <CardContent>Inhalt</CardContent>
      </Card>,
    )
    expect(screen.getByText('Titel')).toBeInTheDocument()
    expect(screen.getByText('Inhalt')).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('renders a status chip with a tone class', () => {
    render(<Badge tone="attack">Attack</Badge>)
    const badge = screen.getByText('Attack')
    expect(badge.className).toContain('bg-type-attack/15')
  })
})

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Dialog">
        Inhalt
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders an accessible dialog when open and closes on Escape', () => {
    let closed = 0
    render(
      <Modal open onClose={() => closed++} title="Dialog">
        Inhalt
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Inhalt')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(1)
  })
})

describe('Toast', () => {
  function Trigger({ message }: { message: string }) {
    const { push } = useToast()
    return <button onClick={() => push(message)}>push</button>
  }

  it('announces a pushed message via an aria-live region', () => {
    render(
      <ToastProvider>
        <Trigger message="Gespeichert" />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'push' }))
    expect(screen.getByRole('status')).toHaveTextContent('Gespeichert')
  })
})

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Erster', content: 'Inhalt A' },
    { id: 'b', label: 'Zweiter', content: 'Inhalt B' },
  ]

  it('renders only the active tabpanel and switches on click', () => {
    render(<Tabs tabs={tabs} />)
    expect(screen.getByRole('tab', { name: 'Erster' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Inhalt A')).toBeInTheDocument()
    expect(screen.queryByText('Inhalt B')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Zweiter' }))
    expect(screen.getByText('Inhalt B')).toBeInTheDocument()
    expect(screen.queryByText('Inhalt A')).not.toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(<EmptyState title="Leer" description="Nichts hier" action={<a href="/login">Anmelden</a>} />)
    expect(screen.getByText('Leer')).toBeInTheDocument()
    expect(screen.getByText('Nichts hier')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeInTheDocument()
  })
})

describe('FormField', () => {
  it('associates label, control and error text via aria-describedby', () => {
    render(
      <FormField label="Benutzername" error="Zu kurz">
        <Input />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: 'Benutzername' })
    // The control got a generated id the label points at…
    const inputId = input.id
    expect(inputId).not.toBe('')
    expect(screen.getByText('Benutzername')).toHaveAttribute('for', inputId)
    // …and the error text is reachable from the control via aria-describedby.
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Zu kurz')
    expect(input).toHaveAttribute('aria-describedby', error.id)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('omits the association when there is no error', () => {
    render(
      <FormField label="Stadt">
        <Input />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: 'Stadt' })
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('SearchInput', () => {
  it('renders a search landmark with a labeled input', () => {
    render(<SearchInput />)
    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Suchen' })).toBeInTheDocument()
  })
})
