// tests/unit/login-callback-url.test.tsx (RC8 issue #20)
// Guest flow: GuestGate on /decks or /collection links to /login?callbackUrl=<path>;
// after a successful sign-in the login form must return the user to that path instead
// of always dumping them on '/'. Invalid targets must fall back to '/' (open-redirect
// guard is unit-tested separately in callback-url.test.ts).
// RC14-Nachzügler #130 — /login is now a server component wrapping the client LoginForm;
// the test renders the form directly with the German dictionary strings.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const push = vi.fn()
const signIn = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (...a: unknown[]) => push(...a) }) }))
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signIn(...a) }))

import { LoginForm } from '@/components/auth/LoginForm'
import deMessages from '@/lib/i18n/messages/de.json'

const t = deMessages.auth.login

async function submitLogin() {
  fireEvent.change(screen.getByLabelText(/benutzername/i), { target: { value: 'tester' } })
  fireEvent.change(screen.getByLabelText(/passwort/i), { target: { value: 'secret1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  await waitFor(() => expect(push).toHaveBeenCalled())
}

describe('LoginForm — callbackUrl return (issue #20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn.mockResolvedValue({ ok: true, error: null })
    window.history.replaceState(null, '', '/login')
  })

  it('shows a context banner when a callbackUrl is present', () => {
    window.history.replaceState(null, '', '/login?callbackUrl=%2Fdecks')
    render(<LoginForm t={t} />)

    expect(screen.getByText(/Du wolltest eine Seite aufrufen, die nur für Mitglieder ist/i)).toBeInTheDocument()
  })

  it('returns to the callbackUrl after a successful login', async () => {
    window.history.replaceState(null, '', '/login?callbackUrl=%2Fdecks')
    render(<LoginForm t={t} />)

    await submitLogin()

    expect(push).toHaveBeenCalledWith('/decks')
  })

  it('falls back to / without a callbackUrl', async () => {
    render(<LoginForm t={t} />)

    await submitLogin()

    expect(push).toHaveBeenCalledWith('/')
  })

  it('falls back to / for a rejected (non-relative) callbackUrl', async () => {
    window.history.replaceState(null, '', '/login?callbackUrl=https%3A%2F%2Fevil.example.com')
    render(<LoginForm t={t} />)

    await submitLogin()

    expect(push).toHaveBeenCalledWith('/')
  })

  it('stays on the form when sign-in fails (no redirect)', async () => {
    window.history.replaceState(null, '', '/login?callbackUrl=%2Fcollection')
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' })
    render(<LoginForm t={t} />)

    fireEvent.change(screen.getByLabelText(/benutzername/i), { target: { value: 'tester' } })
    fireEvent.change(screen.getByLabelText(/passwort/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    await waitFor(() => expect(screen.getByText(/Anmeldung fehlgeschlagen/i)).toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
  })
})
