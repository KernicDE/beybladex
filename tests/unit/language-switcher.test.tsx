// tests/unit/language-switcher.test.tsx (RC14 #17)
// The guest-facing language switcher: renders every supported locale, writes the
// beybladex-locale cookie on change, and refreshes the RSC payload. next/navigation's
// useRouter is seam-mocked (it throws outside an App Router context).
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/lib/i18n/locales'

const labels = { label: 'Sprache', de: 'Deutsch', en: 'English' } as const

describe('LanguageSwitcher', () => {
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
})
