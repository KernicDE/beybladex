// tests/unit/privacy.test.ts
import { describe, it, expect } from 'vitest'
import { resolveVisibleFields } from '@/lib/privacy'

const baseUser = {
  id: 'u1', username: 'alice', displayName: 'Alice', city: 'Zürich', discordTag: 'alice#1',
  bio: 'Attack main since 2024', birthDate: new Date('2000-01-01'), isMinor: false,
  profileVisibility: 'PUBLIC', locationVisibility: 'FRIENDS_ONLY', collectionVisibility: 'PRIVATE',
  decksVisibility: 'PUBLIC', ageVisibility: 'FRIENDS_ONLY',
} as any

const minorUser = { ...baseUser, id: 'u3', username: 'kid', isMinor: true, profileVisibility: 'PUBLIC', locationVisibility: 'PUBLIC' }

describe('resolveVisibleFields', () => {
  it('hides FRIENDS_ONLY fields from a stranger', () => {
    const view = resolveVisibleFields(baseUser, 'u2', false)
    expect(view.city).toBeNull()
    expect(view.birthDate).toBeNull()
  })
  it('shows FRIENDS_ONLY fields to a friend', () => {
    const view = resolveVisibleFields(baseUser, 'u2', true)
    expect(view.city).toBe('Zürich')
    expect(view.birthDate).not.toBeNull()
  })
  it('always hides PRIVATE fields, even from friends', () => {
    const view = resolveVisibleFields(baseUser, 'u2', true)
    expect(view.collectionVisible).toBe(false)
  })
  it('shows everything to the owner regardless of visibility', () => {
    const view = resolveVisibleFields(baseUser, 'u1', false)
    expect(view.city).toBe('Zürich')
    expect(view.collectionVisible).toBe(true)
    expect(view.birthDate).not.toBeNull()
  })
  it('bio follows profileVisibility, not a separate flag', () => {
    const strangerView = resolveVisibleFields(baseUser, 'u2', false)
    expect(strangerView.bio).toBe('Attack main since 2024') // profileVisibility is PUBLIC here
  })
  it('[REVIEW-FIX: privacy-dsgvo #1] hard-ceilings city/discordTag/bio for a minor, even though the minor set them PUBLIC', () => {
    const strangerView = resolveVisibleFields(minorUser, 'u2', false)
    expect(strangerView.city).toBeNull()
    expect(strangerView.discordTag).toBeNull()
    expect(strangerView.bio).toBeNull()
  })
  it('a minor still sees their own full data as the owner', () => {
    const ownerView = resolveVisibleFields(minorUser, 'u3', false)
    expect(ownerView.city).toBe('Zürich')
    expect(ownerView.discordTag).toBe('alice#1')
  })
})
