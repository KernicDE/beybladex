// app/events/[id]/page.tsx
// Canonical PUBLIC event detail page (Task 13 IA decision): map pin, info, participant
// count/list, and the join flow. A guest sees the same content with "Anmelden, um teilzunehmen"
// in place of the join button. The organizer (or an ADMIN) additionally sees each participant's
// check-in status — the day-of check-in table lives in Phase 5's organizer console; check-in
// itself already works here via PATCH /api/tournaments/[id]/checkin.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MapView } from '@/components/map/MapView'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { JoinPanel } from '@/components/tournament/JoinPanel'

export const revalidate = 60 // public, frequently-mutated content [REVIEW-FIX: performance P16]

function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFee(cent: number, currency: string): string {
  if (cent === 0) return 'Eintritt frei'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cent / 100)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [tournament, session] = await Promise.all([
    prisma.tournament.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        startDate: true,
        endDate: true,
        locationName: true,
        street: true,
        postalCode: true,
        city: true,
        state: true,
        country: true,
        latitude: true,
        longitude: true,
        entryFeeCent: true,
        currency: true,
        isRecurring: true,
        createdById: true,
        ruleset: { select: { title: true, slug: true } },
        participants: {
          orderBy: { id: 'asc' },
          select: { userId: true, checkedIn: true, user: { select: { username: true, displayName: true } } },
        },
      },
    }),
    auth(),
  ])
  if (!tournament) notFound()

  const now = new Date()
  const me = session?.user?.id
  const caller = me
    ? await prisma.user.findUnique({ where: { id: me }, select: { role: true } })
    : null
  const myParticipation = me
    ? tournament.participants.find((p) => p.userId === me)
    : undefined
  const isOrganizer = me !== undefined && (tournament.createdById === me || caller?.role === 'ADMIN')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{tournament.title}</h1>
        {tournament.isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
      </div>

      <MapView
        className="z-0 h-64 w-full rounded-xl border border-x-cyan/20 sm:h-80"
        center={{ lat: tournament.latitude, lng: tournament.longitude }}
        zoom={13}
        markers={[{ id: tournament.id, lat: tournament.latitude, lng: tournament.longitude, label: tournament.title }]}
      />

      <Card className="space-y-2 p-4 text-sm">
        <p>
          <span className="font-medium">Zeit: </span>
          {formatDateTime(tournament.startDate)}
          {tournament.endDate && ` – ${formatDateTime(tournament.endDate)}`}
        </p>
        <p>
          <span className="font-medium">Ort: </span>
          {tournament.locationName}, {tournament.street ? `${tournament.street}, ` : ''}
          {tournament.postalCode} {tournament.city}, {tournament.state} ({tournament.country})
        </p>
        <p>
          <span className="font-medium">Eintritt: </span>
          {formatFee(tournament.entryFeeCent, tournament.currency)}
        </p>
        <p>
          <span className="font-medium">Regelwerk: </span>
          <Link href={`/rules/${tournament.ruleset.slug}`} className="text-x-cyan-text hover:underline">
            {tournament.ruleset.title}
          </Link>
        </p>
      </Card>

      {/* Join flow — guests get the sign-in prompt instead of the join button (Task 13 convention). */}
      {!me ? (
        <Link
          href="/login"
          className="inline-block rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          Anmelden, um teilzunehmen
        </Link>
      ) : (
        <JoinPanel
          tournamentId={tournament.id}
          joined={myParticipation !== undefined}
          checkedIn={myParticipation?.checkedIn ?? false}
          checkInOpen={isSameDay(now, tournament.startDate)}
          canWithdraw={now <= tournament.startDate}
        />
      )}

      <p className="text-sm">
        <Link href={`/tournaments/${tournament.id}`} className="text-x-cyan-text hover:underline">
          Turnierbaum & Judge-Bereich →
        </Link>
      </p>

      <section aria-labelledby="participants-heading" className="space-y-3">
        <h2 id="participants-heading" className="text-lg font-semibold">
          Teilnehmer ({tournament.participants.length})
        </h2>
        {tournament.participants.length === 0 ? (
          <p className="text-sm text-current/60">Noch keine Anmeldungen — sei die erste Person!</p>
        ) : (
          <ul className="space-y-2">
            {tournament.participants.map((p) => (
              <li key={p.userId} className="flex items-center justify-between rounded-md border border-current/10 px-3 py-2 text-sm">
                <span>{p.user.displayName ?? p.user.username}</span>
                {isOrganizer &&
                  (p.checkedIn ? (
                    <Badge tone="cyan">Eingecheckt</Badge>
                  ) : (
                    <Badge tone="neutral">Nicht eingecheckt</Badge>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {tournament.description && (
        <section aria-labelledby="description-heading" className="space-y-2">
          <h2 id="description-heading" className="text-lg font-semibold">
            Beschreibung
          </h2>
          <MarkdownContent className="text-sm text-current/80">{tournament.description}</MarkdownContent>
        </section>
      )}
    </main>
  )
}
