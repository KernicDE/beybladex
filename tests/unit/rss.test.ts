// tests/unit/rss.test.ts
// Phase 3: buildTournamentFeed produces WELL-FORMED XML (parsed with a real XML parser,
// not string matching — the plan's explicit acceptance criterion) and filters by scope.
import { describe, it, expect } from 'vitest'
import type { Tournament } from '@prisma/client'
import { buildTournamentFeed } from '@/lib/rss'

function makeTournament(overrides: Partial<Tournament>): Tournament {
  return {
    id: 't-1',
    title: 'Test Turnier',
    description: 'Eine Beschreibung',
    startDate: new Date('2026-10-01T10:00:00Z'),
    endDate: null,
    locationName: 'Spielhalle',
    street: null,
    postalCode: '10115',
    city: 'Berlin',
    state: 'Berlin',
    country: 'DE',
    latitude: 52.52,
    longitude: 13.405,
    entryFeeCent: 0,
    currency: 'EUR',
    isRecurring: false,
    recurringDays: null,
    rulesetId: 'r-1',
    clubId: null,
    createdById: 'u-1',
    ...overrides,
  }
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc
}

const TOURNAMENTS: Tournament[] = [
  makeTournament({ id: 't-de-1', title: 'Berlin Battle', state: 'Berlin', city: 'Berlin', country: 'DE', startDate: new Date('2026-10-01T10:00:00Z') }),
  makeTournament({ id: 't-de-2', title: 'München Masters', state: 'Bayern', city: 'München', country: 'DE', startDate: new Date('2026-10-05T10:00:00Z') }),
  makeTournament({ id: 't-at-1', title: 'Wien Open', state: 'Wien', city: 'Wien', country: 'AT', startDate: new Date('2026-10-03T10:00:00Z') }),
]

describe('buildTournamentFeed', () => {
  it('produces well-formed RSS 2.0 with channel metadata', () => {
    const doc = parseXml(buildTournamentFeed(TOURNAMENTS, {}))
    expect(doc.documentElement.tagName).toBe('rss')
    expect(doc.documentElement.getAttribute('version')).toBe('2.0')
    expect(doc.querySelector('channel > title')!.textContent).toContain('BeybladeX.de')
    expect(doc.querySelector('channel > language')!.textContent).toBe('de')
    expect(doc.querySelectorAll('item')).toHaveLength(3)
  })

  it('scopes by country', () => {
    const doc = parseXml(buildTournamentFeed(TOURNAMENTS, { country: 'de' }))
    const titles = [...doc.querySelectorAll('item > title')].map((n) => n.textContent)
    expect(titles).toEqual(['Berlin Battle', 'München Masters'])
    expect(doc.querySelector('channel > title')!.textContent).toContain('Deutschland')
  })

  it('scopes by country AND state (case-insensitive)', () => {
    const doc = parseXml(buildTournamentFeed(TOURNAMENTS, { country: 'de', state: 'BAYERN' }))
    const titles = [...doc.querySelectorAll('item > title')].map((n) => n.textContent)
    expect(titles).toEqual(['München Masters'])
  })

  it('renders an empty-but-valid feed when nothing matches the scope', () => {
    const doc = parseXml(buildTournamentFeed(TOURNAMENTS, { country: 'ch' }))
    expect(doc.querySelectorAll('item')).toHaveLength(0)
    expect(doc.querySelector('parsererror')).toBeNull()
  })

  it('XML-escapes titles and descriptions containing markup characters', () => {
    const nasty = makeTournament({ id: 't-x', title: 'A & B <script>"quotes"</script>', description: 'Beschreibung mit <html> & "Anführungszeichen"' })
    const doc = parseXml(buildTournamentFeed([nasty], {}))
    expect(doc.querySelector('item > title')!.textContent).toBe('A & B <script>"quotes"</script>')
    expect(doc.getElementsByTagName('content:encoded')[0].textContent).toContain('Beschreibung mit <html>')
  })

  it('emits RFC-822 pubDate and a georss point per item', () => {
    const doc = parseXml(buildTournamentFeed(TOURNAMENTS, {}))
    const item = doc.querySelector('item')!
    expect(item.querySelector('pubDate')!.textContent).toMatch(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    expect(item.getElementsByTagName('georss:point')[0].textContent).toBe('52.52 13.405')
    expect(item.querySelector('guid')!.textContent).toContain('/events/t-de-1')
  })
})
