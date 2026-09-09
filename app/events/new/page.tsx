// app/events/new/page.tsx
// Tournament-creation entry. AUTHZ mirrors the API: only ORGANIZER/ADMIN sessions reach the
// form (guests → login, other roles → back to /events with the API enforcing the same rule).
// TODO(Phase 4): club-admin sessions get here too, with a club preselection once Club
// membership exists.
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { TournamentForm } from '@/components/tournament/TournamentForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function NewEventPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'ORGANIZER' && caller?.role !== 'ADMIN') redirect('/events')

  const rulesets = await prisma.ruleset.findMany({
    where: { isPublic: true },
    orderBy: { title: 'asc' },
    select: { id: true, title: true },
  })

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Turnier erstellen</h1>
      <TournamentForm rulesets={rulesets} />
    </main>
  )
}
