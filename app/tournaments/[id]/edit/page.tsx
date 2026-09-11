// app/tournaments/[id]/edit/page.tsx (Phase 10 item 2)
// Edit an existing Tournament — reuses TournamentForm in 'edit' mode (PATCHes
// /api/tournaments/[id]) instead of duplicating the form. Owner-only page gate, same authz
// rule as the API itself (createdById or ADMIN); everyone else gets a 404, not 403 — the
// standing not-403 privacy policy for gated pages, applied here since a tournament's
// existence is already public via /events/[id] but its EDIT surface should not confirm to a
// stranger which account owns it via a distinguishable 403 vs 404.
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { TournamentForm, type TournamentFormValues } from '@/components/tournament/TournamentForm'

export const dynamic = 'force-dynamic'

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}
function toTimeInput(date: Date): string {
  return date.toISOString().slice(11, 16)
}

export default async function EditTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true, title: true, description: true, startDate: true, endDate: true,
      locationName: true, street: true, postalCode: true, city: true, state: true, country: true,
      latitude: true, longitude: true, entryFeeCent: true, currency: true, isRecurring: true,
      recurringDays: true, rulesetId: true, clubId: true, createdById: true, rankedEligible: true,
      teamMode: true, _count: { select: { participants: true, teamEntries: true } },
    },
  })
  if (!tournament) notFound()

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  const isOwner = tournament.createdById === session.user.id || caller?.role === 'ADMIN'
  if (!isOwner) notFound()

  const [rulesets, memberships] = await Promise.all([
    prisma.ruleset.findMany({ where: { isPublic: true }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.clubMember.findMany({
      where: { userId: session.user.id, isAdmin: true, status: 'ACTIVE' },
      select: { club: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ])
  const adminClubs = memberships.map((m) => m.club)

  const initialValues: TournamentFormValues = {
    title: tournament.title,
    description: tournament.description,
    date: toDateInput(tournament.startDate),
    startTime: toTimeInput(tournament.startDate),
    endTime: tournament.endDate ? toTimeInput(tournament.endDate) : '',
    locationName: tournament.locationName,
    street: tournament.street ?? '',
    postalCode: tournament.postalCode,
    city: tournament.city,
    state: tournament.state,
    country: tournament.country,
    latitude: String(tournament.latitude),
    longitude: String(tournament.longitude),
    entryFeeCent: (tournament.entryFeeCent / 100).toString(),
    currency: tournament.currency,
    isRecurring: tournament.isRecurring,
    recurringDays: tournament.recurringDays === null ? '' : String(tournament.recurringDays),
    rankedEligible: tournament.rankedEligible,
    teamMode: tournament.teamMode,
    rulesetId: tournament.rulesetId,
    clubId: tournament.clubId ?? '',
  }

  // RC15 #12 — team mode is frozen at the first registration (server returns 409
  // registrations_exist); the checkbox reflects that so the organizer sees WHY it is locked.
  const teamModeLocked = tournament._count.participants > 0 || tournament._count.teamEntries > 0

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Turnier bearbeiten</h1>
      <TournamentForm
        rulesets={rulesets}
        clubs={adminClubs}
        mode="edit"
        tournamentId={tournament.id}
        initialValues={initialValues}
        teamModeLocked={teamModeLocked}
      />
    </main>
  )
}
