// app/events/new/page.tsx
// Tournament-creation entry. AUTHZ mirrors the API: a session reaches the form if it has the
// ORGANIZER/ADMIN role OR administers at least one club (ClubMember.isAdmin — Phase 4's
// corrected authz rule; guests → login, everyone else → back to /events). Administered clubs
// populate the form's optional clubId dropdown; ?clubId= pre-selects one (validated against
// the administered list inside TournamentForm).
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { TournamentForm } from '@/components/tournament/TournamentForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ clubId?: string }>
}) {
  const { clubId } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  const memberships = await prisma.clubMember.findMany({
    where: { userId: session.user.id, isAdmin: true },
    select: { club: { select: { id: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  })
  const adminClubs = memberships.map((m) => m.club)

  const hasGlobalRole = caller?.role === 'ORGANIZER' || caller?.role === 'ADMIN'
  if (!hasGlobalRole && adminClubs.length === 0) redirect('/events')

  const rulesets = await prisma.ruleset.findMany({
    where: { isPublic: true },
    orderBy: { title: 'asc' },
    select: { id: true, title: true },
  })

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Turnier erstellen</h1>
      <TournamentForm rulesets={rulesets} clubs={adminClubs} initialClubId={clubId ?? ''} />
    </main>
  )
}
