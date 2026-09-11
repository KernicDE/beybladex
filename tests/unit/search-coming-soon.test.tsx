// tests/unit/search-coming-soon.test.tsx (RC8 issue #25)
// The Events/Clubs search backends don't exist yet — the page must mark those categories
// as "Demnächst" UP FRONT (in the section heading), not only inside the results after a
// search. Regression test: the badge is visible without any query (before interaction)
// and stays visible after searching. Seams mocked on '@/' imports; no DB/Redis.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('@/lib/userSearch', () => ({
  searchUsers: vi.fn(async () => ({ users: [], nextCursor: null })),
}))
vi.mock('@/lib/buildSearch', () => ({
  searchParts: vi.fn(async () => ({ parts: [] })),
}))
vi.mock('@/lib/metaCache', () => ({ getPartStats: vi.fn(async () => new Map()) }))
vi.mock('@/components/proposals/CatalogProposalCTA', () => ({
  CatalogProposalCTA: () => null,
}))

import { searchParts } from '@/lib/buildSearch'
import { searchUsers } from '@/lib/userSearch'
import SearchPage from '@/app/search/page'

function renderPage(searchParams: Record<string, string | undefined>) {
  // SearchPage is an async server component — await it, then render the element.
  return SearchPage({ searchParams: Promise.resolve(searchParams) } as never).then((el) =>
    render(el),
  )
}

describe('/search — coming-soon categories (issue #25)', () => {
  it('marks Events and Clubs as "Demnächst" before any search is entered', async () => {
    await renderPage({})

    expect(screen.getByRole('heading', { name: 'Nutzer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Teile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /events/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /clubs/i })).toBeInTheDocument()

    const badges = screen.getAllByText('Demnächst')
    expect(badges).toHaveLength(2)
    expect(badges[0]).toHaveAttribute(
      'aria-label',
      'Events-Suche noch nicht verfügbar',
    )
    expect(badges[1]).toHaveAttribute('aria-label', 'Clubs-Suche noch nicht verfügbar')

    // The functional categories are NOT marked as coming soon.
    expect(screen.queryByLabelText('Nutzer-Suche noch nicht verfügbar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Teile-Suche noch nicht verfügbar')).not.toBeInTheDocument()
  })

  it('keeps the coming-soon markers visible after a search, while the functional backends run', async () => {
    await renderPage({ q: 'dranzer' })

    expect(searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'dranzer' }),
    )
    expect(searchParts).toHaveBeenCalledWith({ q: 'dranzer' })
    expect(screen.getAllByText('Demnächst')).toHaveLength(2)
    expect(screen.getAllByText('Suche noch nicht verfügbar').length).toBeGreaterThan(0)
  })
})
