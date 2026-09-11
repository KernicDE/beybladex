// tests/unit/format-datetime.test.ts (hotfix #98)
// formatDateTime MUST pin Europe/Berlin: the production container runs UTC (no TZ in the
// Dockerfile), so a host-dependent toLocaleString rendered shifted/ambiguous times and could
// diverge between server HTML and any client-side re-render. The expected values below are
// Berlin wall-clock times — if the explicit timeZone option ever regresses, the host's zone
// decides the output and these assertions fail regardless of where the suite runs.
import { describe, it, expect } from 'vitest'
import { formatDateTime } from '@/lib/formatDateTime'

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
