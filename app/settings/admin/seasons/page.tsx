// app/settings/admin/seasons/page.tsx (Phase 14)
// ADMIN-only Season management: create a new season (auto-completing the current ACTIVE one
// and seeding regressed ratings), and a plain list of past seasons for reference.
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { SeasonCreateForm } from '@/components/admin/SeasonCreateForm'

export const dynamic = 'force-dynamic'

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function AdminSeasonsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'ADMIN') redirect('/settings/profile')

  const seasons = await prisma.season.findMany({ orderBy: { startsAt: 'desc' } })
  const active = seasons.find((s) => s.status === 'ACTIVE') ?? null

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Seasons (Rangliste)</h1>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">{active ? 'Neue Season starten' : 'Erste Season starten'}</CardTitle>
        <SeasonCreateForm activeSeasonId={active?.id ?? null} />
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Alle Seasons</h2>
        {seasons.length === 0 ? (
          <p className="text-sm text-current/60">Noch keine Season angelegt.</p>
        ) : (
          <ul className="space-y-2">
            {seasons.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md border border-current/10 px-3 py-2 text-sm">
                <span>
                  {s.name}
                  <span className="ml-2 text-xs text-current/50">
                    {formatDate(s.startsAt)} – {formatDate(s.endsAt)}
                  </span>
                </span>
                <Badge tone={s.status === 'ACTIVE' ? 'green' : 'neutral'}>{s.status === 'ACTIVE' ? 'Aktiv' : 'Abgeschlossen'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
