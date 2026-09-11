// components/tournament/EventListCard.tsx (RC9 #32)
// The /events list's event card, extracted from app/events/page.tsx so its rendering is
// unit-testable and stays consistent:
// - #32 — price, location and participants are VISUALLY separated: date/time as a muted prefix,
//   the title link contains only the title, the price is its own chip, and the second line
//   renders Ort / Land / Teilnehmer as distinct middot-separated spans (previously
//   "10,00 €DE, Hessen, Wiesbaden" ran together in one link text).
// Map-variant note: LeafletMap markers show only the title tooltip, so there is no metadata
// to separate there; the event detail page already renders each meta on its own labeled row.
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
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
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
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
}: EventListCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Line 1 — each datum its own element: muted date/time prefix, title-only link,
              status badges and the price as a separate chip (was: everything concatenated
              inside the link text, "€DE, Hessen" ran together). */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-current/60">
              {formatDate(startDate)} {formatTime(startDate)}
            </span>
            <Link href={`/events/${id}`} className="font-semibold hover:underline">
              {title}
            </Link>
            {isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
            <Badge tone="neutral">{formatFee(entryFeeCent, currency)}</Badge>
          </p>
          {/* Line 2 — location/country/participants as distinct, middot-separated spans. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-current/60">
            <span>
              {city}, {state}
            </span>
            <span aria-hidden="true">·</span>
            <span>{COUNTRY_LABELS[country]}</span>
            <span aria-hidden="true">·</span>
            <span>{participantCount} Teilnehmer</span>
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
