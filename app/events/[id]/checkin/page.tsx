// app/events/[id]/checkin/page.tsx (Phase 7, item 2)
// Self-service QR check-in landing page — the URL a printed/displayed venue QR code encodes.
// Validates `t` against Tournament.checkInToken (403-equivalent inline message on mismatch —
// this is a convenience/venue-scoping check, not an anti-fraud system, see the checkin route's
// header comment) and, for a logged-in registered participant, renders the actual check-in
// button (SelfCheckinButton). A guest is prompted to log in first (redirect back to this exact
// URL, token included, so the QR flow completes after auth).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Card } from '@/components/ui/Card'
import { SelfCheckinButton } from '@/components/tournament/SelfCheckinButton'

export const dynamic = 'force-dynamic'

export default async function EventCheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { id } = await params
  const { t } = await searchParams
  const [tournament, session] = await Promise.all([
    prisma.tournament.findUnique({ where: { id }, select: { id: true, title: true, checkInToken: true } }),
    auth(),
  ])
  if (!tournament) notFound()

  const tokenValid = t === tournament.checkInToken

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Check-in: {tournament.title}</h1>
      <Card className="p-4">
        {!tokenValid ? (
          <p role="alert" className="text-sm text-type-attack">
            Dieser QR-Code ist ungültig oder abgelaufen. Bitte wende dich an die Turnierleitung.
          </p>
        ) : !session?.user?.id ? (
          <div className="space-y-2 text-sm">
            <p>Bitte melde dich an, um dich einzuchecken.</p>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/events/${id}/checkin?t=${t}`)}`}
              className="inline-block rounded-md border border-current/30 px-4 py-2 font-medium transition-colors hover:bg-current/5"
            >
              Anmelden
            </Link>
          </div>
        ) : (
          <CheckinGate tournamentId={id} userId={session.user.id} token={t!} />
        )}
      </Card>
    </main>
  )
}

async function CheckinGate({ tournamentId, userId, token }: { tournamentId: string; userId: string; token: string }) {
  // RC15 #12 — team mode: the viewer checks in their TEAM (via the entry's slots), not a solo
  // participant row.
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      teamMode: true,
      participants: { where: { userId }, select: { checkedIn: true } },
      teamEntries: {
        where: { slots: { some: { userId } } },
        select: { id: true, checkedIn: true, team: { select: { name: true } } },
      },
    },
  })
  if (!tournament) notFound()

  if (tournament.teamMode) {
    const entry = tournament.teamEntries[0]
    if (!entry) {
      return (
        <p className="text-sm text-current/70">
          Du bist für dieses Turnier nicht mit einem Team angemeldet.{' '}
          <Link href={`/events/${tournamentId}`} className="text-x-cyan-text hover:underline">
            Zur Turnierseite
          </Link>
        </p>
      )
    }
    return (
      <div className="space-y-2">
        <p className="text-sm text-current/70">Team: {entry.team.name}</p>
        <SelfCheckinButton tournamentId={tournamentId} token={token} alreadyCheckedIn={entry.checkedIn} entryId={entry.id} />
      </div>
    )
  }

  const participant = tournament.participants[0]
  if (!participant) {
    return (
      <p className="text-sm text-current/70">
        Du bist für dieses Turnier nicht angemeldet.{' '}
        <Link href={`/events/${tournamentId}`} className="text-x-cyan-text hover:underline">
          Zur Turnierseite
        </Link>
      </p>
    )
  }
  return <SelfCheckinButton tournamentId={tournamentId} token={token} alreadyCheckedIn={participant.checkedIn} />
}
