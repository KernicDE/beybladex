// app/page.tsx
// Landing page (Task 13 decision, binding): guests get a hero + "was ist
// BeybladeX.de" + register CTA. Logged-in users get the personalized dashboard
// (components/home/LoggedInDashboard.tsx, RC9 #31): the soonest upcoming event they
// participate in and the latest chat message across their ACTIVE club memberships, each with
// a discovery-CTA fallback — issue #31's documented decision is DYNAMIC BLOCK over redirect,
// since both datasets exist in the DB today.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { withPublicCache } from '@/lib/publicCache'
import { getDictionary } from '@/lib/i18n/server'
import { LoggedInDashboard } from '@/components/home/LoggedInDashboard'
import { GuestLanding } from '@/components/home/GuestLanding'

export default async function Home() {
  const session = await auth()
  const user = session?.user

  if (user?.id && user.name) {
    const userId = user.id
    // #31 — two small reads, intentionally uncached: this page is per-request anyway (auth()),
    // the queries are cheap single-indexed lookups, and a dashboard must not lag behind a
    // join/checkin/chat post.
    const [nextEvent, memberships] = await Promise.all([
      prisma.tournament.findFirst({
        where: { startDate: { gte: new Date() }, participants: { some: { userId } } },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true, startDate: true, city: true },
      }),
      prisma.clubMember.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { club: { select: { id: true, name: true, slug: true } } },
      }),
    ])

    // Latest chat message across all of the user's clubs. ClubMessage.authorId is a plain
    // string (survives account erasure, Phase 12), so the author's display name is a separate
    // best-effort lookup — a dangling authorId renders as "Gelöschter Nutzer".
    const message = memberships.length
      ? await prisma.clubMessage.findFirst({
          where: { clubId: { in: memberships.map((m) => m.club.id) } },
          orderBy: { createdAt: 'desc' },
          select: { body: true, createdAt: true, authorId: true, clubId: true },
        })
      : null
    const [author, messageClub] = message
      ? await Promise.all([
          prisma.user.findUnique({ where: { id: message.authorId }, select: { username: true, displayName: true } }),
          Promise.resolve(memberships.find((m) => m.club.id === message.clubId)?.club ?? null),
        ])
      : [null, null]

    return (
      <LoggedInDashboard
        name={user.name}
        nextEvent={nextEvent}
        clubActivity={
          message && messageClub
            ? {
                clubSlug: messageClub.slug,
                clubName: messageClub.name,
                authorName: author?.displayName ?? author?.username ?? 'Gelöschter Nutzer',
                body: message.body,
                createdAt: message.createdAt,
              }
            : null
        }
      />
    )
  }

  // #88 — the guest landing's "Kommende Events" teaser: the soonest upcoming public events,
  // same public-core pattern as app/events (60s Redis TTL, degrade-to-query). Empty results
  // stay uncached (produce returns null) so the very first published event appears at once;
  // non-empty results may lag one TTL window, same tradeoff as the /events list.
  const upcomingEvents = await withPublicCache('public:v1:landing:upcoming-events', 60, async () => {
    const rows = await prisma.tournament.findMany({
      where: { startDate: { gte: new Date() } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 3,
      select: { id: true, title: true, startDate: true, city: true, state: true, country: true },
    })
    return rows.length ? rows : null
  })

  // RC14 #17 — the guest landing's chrome/marketing copy renders in the request locale;
  // the logged-in dashboard's copy is a documented follow-up (#17 ships the i18n core first).
  const t = await getDictionary()
  return <GuestLanding upcomingEvents={upcomingEvents ?? []} t={t} />
}
