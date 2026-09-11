// tests/unit/format-datetime.test.ts (hotfix #98)
// formatDateTime MUST pin Europe/Berlin: the production container runs UTC (no TZ in the
// Dockerfile), so a host-dependent toLocaleString rendered shifted/ambiguous times and could
// diverge between server HTML and any client-side re-render. The expected values below are
// Berlin wall-clock times — if the explicit timeZone option ever regresses, the host's zone
// decides the output and these assertions fail regardless of where the suite runs.
import { describe, it, expect } from 'vitest'
import { formatDateTime, formatDateDay, formatTimeHM, formatEventTime } from '@/lib/formatDateTime'

describe('formatDateTime (issue #98)', () => {
  it('renders Europe/Berlin time even when the host runs UTC (CEST summer)', () => {
    // 2026-09-11 14:00 UTC = 16:00 CEST
    const rendered = formatDateTime(new Date('2026-09-11T14:00:00Z'))
    expect(rendered).toContain('16:00')
    expect(rendered).not.toContain('14:00')
    expect(rendered).toContain('11. September 2026')
  })

  it('renders Europe/Berlin time even when the host runs UTC (CET winter)', () => {
    // 2026-01-11 14:00 UTC = 15:00 CET — also guards against a hardcoded +2 summer offset
    const rendered = formatDateTime(new Date('2026-01-11T14:00:00Z'))
    expect(rendered).toContain('15:00')
    expect(rendered).not.toContain('14:00')
  })

  it('formats with the German weekday/month vocabulary', () => {
    // 2026-09-11 is a Friday
    expect(formatDateTime(new Date('2026-09-11T14:00:00Z'))).toMatch(/^Fr\./)
  })
})

describe('formatDateDay / formatTimeHM (RC11 #80)', () => {
  it('renders the long weekday plus TT.MM.JJJJ in Berlin time', () => {
    // 2026-09-11 is a Friday
    expect(formatDateDay(new Date('2026-09-11T14:00:00Z'))).toBe('Freitag, 11.09.2026')
  })

  it('renders HH:MM in Berlin time', () => {
    // 2026-09-11 14:00 UTC = 16:00 CEST
    expect(formatTimeHM(new Date('2026-09-11T14:00:00Z'))).toBe('16:00')
  })
})

describe('formatEventTime (RC11 #81)', () => {
  it('single day: one date, "von … Uhr bis … Uhr"', () => {
    const start = new Date('2026-09-11T08:30:00Z') // 10:30 CEST
    const end = new Date('2026-09-11T15:30:00Z') // 17:30 CEST
    expect(formatEventTime(start, end)).toBe('Freitag, 11.09.2026 von 10:30 Uhr bis 17:30 Uhr')
  })

  it('multi-day: both dates stay visible', () => {
    const start = new Date('2026-09-11T08:00:00Z') // 10:00 CEST
    const end = new Date('2026-09-12T16:00:00Z') // 18:00 CEST
    expect(formatEventTime(start, end)).toBe(
      'Freitag, 11.09.2026, 10:00 Uhr bis Samstag, 12.09.2026, 18:00 Uhr',
    )
  })

  it('without endDate: "um … Uhr"', () => {
    const start = new Date('2026-09-11T08:30:00Z') // 10:30 CEST
    expect(formatEventTime(start, null)).toBe('Freitag, 11.09.2026 um 10:30 Uhr')
  })

  it('same-day check runs in Europe/Berlin, not the host zone', () => {
    // 2026-09-11 22:00 UTC = 2026-09-12 00:00 CEST and 23:00 UTC = 01:00 CEST: BOTH times
    // fall on Saturday 12.09. in Berlin, so the single-day form must be used. A naive UTC-host
    // getDate() comparison sees "11 vs 11", calls them the same day anyway — the interesting
    // failure is the opposite direction: it would attribute the shared date to the WRONG day.
    const start = new Date('2026-09-11T22:00:00Z')
    const end = new Date('2026-09-11T23:00:00Z')
    expect(formatEventTime(start, end)).toBe('Samstag, 12.09.2026 von 00:00 Uhr bis 01:00 Uhr')
  })
})
