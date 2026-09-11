// components/tournament/EventListCard.tsx (RC9 #32, #27 adds the tournament badges; RC11 #80
// reorders line 1)
// The /events list's event card, extracted from app/events/page.tsx so its rendering is
// unit-testable and stays consistent:
// - #80 — line 1 is title-first: `Titel – Freitag, 11.09.2026, 10:30 Uhr` (ausgeschriebener
//   Wochentag, TT.MM.JJJJ); the entry fee moved out of line 1 and closes line 2 after the
//   participants (`… · 12 Teilnehmer · 10,00 €`).
// - #32 — price, location and participants stay VISUALLY separated: the title link contains
//   only the title, and the second line renders Ort / Land / Teilnehmer / Preis as distinct
//   middot-separated spans (previously "10,00 €DE, Hessen, Wiesbaden" ran together).
// - #27 — the Event↔Turnier link is visible without opening the event: a started tournament
//   gets a "Turnier live" badge, one with generated stages a "Bracket verfügbar" badge;
//   events without either show NO badge (no misleading hint).
// Map-variant note: LeafletMap markers show only the title tooltip, so there is no metadata
// to separate there; the event detail page already renders each meta on its own labeled row.
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { formatDateDay, formatTimeHM } from '@/lib/formatDateTime'
import type { DachCountry } from '@/lib/dachRegions'

const COUNTRY_LABELS: Record<DachCountry, string> = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
}

export interface EventListCardProps {
  id: string
  title: string
  startDate: Date
  city: string
  state: string
  country: DachCountry
  entryFeeCent: number
  currency: string
  isRecurring: boolean
  participantCount: number
  headerImageId: string | null
  /** #27 — stages generated for this event's tournament (Bracket vorhanden). */
  stageCount: number
  /** #27 — set once the organizer started the tournament (Turnier live). */
  startedAt: Date | null
}

function formatFee(cent: number, currency: string): string {
  if (cent === 0) return 'Eintritt frei'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cent / 100)
}

export function EventListCard({
  id,
  title,
  startDate,
  city,
  state,
  country,
  entryFeeCent,
  currency,
  isRecurring,
  participantCount,
  headerImageId,
  stageCount,
  startedAt,
}: EventListCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Line 1 (#80) — title first, then date/weekday/time as a muted suffix; status
              badges follow. The entry fee lives at the end of line 2, not here. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/events/${id}`} className="font-semibold hover:underline">
              {title}
            </Link>
            <span aria-hidden="true" className="text-current/40">–</span>
            <span className="text-sm text-current/60">
              {formatDateDay(startDate)}, {formatTimeHM(startDate)} Uhr
            </span>
            {isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
            {startedAt ? (
              <Badge tone="green">Turnier live</Badge>
            ) : stageCount > 0 ? (
              <Badge tone="cyan">Bracket verfügbar</Badge>
            ) : null}
          </p>
          {/* Line 2 — location/country/participants as distinct, middot-separated spans; the
              entry fee closes the line (#80). */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-current/60">
            <span>
              {city}, {state}
            </span>
            <span aria-hidden="true">·</span>
            <span>{COUNTRY_LABELS[country]}</span>
            <span aria-hidden="true">·</span>
            <span>{participantCount} Teilnehmer</span>
            <span aria-hidden="true">·</span>
            <span>{formatFee(entryFeeCent, currency)}</span>
          </p>
        </div>
        {/* Phase 11 item 5 cross-reference: right-aligned thumbnail once a header image is
            set; a card with none keeps the text-only layout unchanged. */}
        {headerImageId && (
          <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md">
            <Image src={`/api/media/${headerImageId}`} alt="" fill sizes="96px" className="object-cover" />
          </div>
        )}
      </div>
    </Card>
  )
}
