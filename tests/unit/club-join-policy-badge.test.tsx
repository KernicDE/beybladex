// tests/unit/club-join-policy-badge.test.tsx (RC12, issue #83)
// The club directory card must surface Club.joinPolicy without opening each club: OPEN
// reads "Offen", APPLICATION "Bewerbung", INVITE_ONLY "Auf Einladung". The mapping lives
// in components/clubs/ClubJoinPolicyBadge.tsx and is rendered by app/clubs/page.tsx
// (which also selects joinPolicy — verifiable only against the DB in CI).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ClubJoinPolicyBadge } from '@/components/clubs/ClubJoinPolicyBadge'

describe('ClubJoinPolicyBadge (issue #83)', () => {
  it('labels OPEN as "Offen"', () => {
    render(<ClubJoinPolicyBadge policy="OPEN" />)
    expect(screen.getByText('Offen')).toBeInTheDocument()
  })

  it('labels APPLICATION as "Bewerbung"', () => {
    render(<ClubJoinPolicyBadge policy="APPLICATION" />)
    expect(screen.getByText('Bewerbung')).toBeInTheDocument()
  })

  it('labels INVITE_ONLY as "Auf Einladung"', () => {
    render(<ClubJoinPolicyBadge policy="INVITE_ONLY" />)
    expect(screen.getByText('Auf Einladung')).toBeInTheDocument()
  })

  it('renders exactly one badge per policy', () => {
    render(<ClubJoinPolicyBadge policy="OPEN" />)
    expect(screen.getAllByText('Offen')).toHaveLength(1)
  })
})
