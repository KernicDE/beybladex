// tests/unit/language-switcher.test.tsx (RC14 #17, fix #129)
// The language switcher: renders every supported locale, writes the beybladex-locale cookie on
// change, and refreshes the RSC payload. For signed-in viewers (#129) the choice must ALSO be
// PATCHed to /api/profile — User.language would otherwise win over the cookie and silently undo
// the switch. next/navigation's useRouter is seam-mocked (it throws outside an App Router
// context).
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/lib/i18n/locales'

const labels = { label: 'Sprache', de: 'Deutsch', en: 'English' } as const

const fetchMock = vi.fn()

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists every supported locale with its native label', () => {
    render(<LanguageSwitcher current="de" labels={labels} />)
    const select = screen.getByRole('combobox', { name: 'Sprache' })
    for (const locale of SUPPORTED_LOCALES) {
      expect(select.querySelector(`option[value="${locale}"]`)).not.toBeNull()
    }
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
  })

  it('writes the locale cookie and refreshes on change', () => {
    render(<LanguageSwitcher current="de" labels={labels} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sprache' }), { target: { value: 'en' } })
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`)
    expect(refresh).toHaveBeenCalled()
  })

  it('does NOT touch the profile API for guests', () => {
    render(<LanguageSwitcher current="de" labels={labels} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sprache' }), { target: { value: 'en' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #129 — signed-in viewers: User.language outranks the cookie in lib/i18n/server.ts's
  // resolution order, so switching must persist to the profile or the UI never changes.
  it('PATCHes User.language for signed-in viewers', async () => {
    render(<LanguageSwitcher current="de" labels={labels} authed />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sprache' }), { target: { value: 'en' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profile')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ language: 'en' })
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`)
    expect(refresh).toHaveBeenCalled()
  })

  it('still refreshes when the profile PATCH fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<LanguageSwitcher current="de" labels={labels} authed />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sprache' }), { target: { value: 'en' } })

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
