// tests/unit/deck-lock.test.ts (Issue #181 — "Decklock")
import { describe, it, expect } from 'vitest'
import { resolveDeckLockAt } from '@/lib/deckLock'

describe('resolveDeckLockAt', () => {
  const startDate = new Date('2026-10-03T10:00:00.000Z')

  it('fällt ohne eigene Sperrfrist auf den Event-Start zurück', () => {
    expect(resolveDeckLockAt(null, startDate)).toEqual(startDate)
  })

  it('respektiert eine explizit gesetzte (auch vor dem Event-Start liegende) Sperrfrist', () => {
    const earlier = new Date('2026-10-01T18:00:00.000Z')
    expect(resolveDeckLockAt(earlier, startDate)).toEqual(earlier)
  })
})
