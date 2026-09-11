// app/page.tsx
// Landing page (Task 13 decision, binding): guests get a hero + "was ist
// BeybladeX.de" + register CTA. Logged-in users get the personalized dashboard
// (components/home/LoggedInDashboard.tsx, RC9 #31): the soonest upcoming event they
// participate in and the latest chat message across their ACTIVE club memberships, each with
// a discovery-CTA fallback — issue #31's documented decision is DYNAMIC BLOCK over redirect,
// since both datasets exist in the DB today.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { BrandMark } from '@/components/brand/BrandMark'
import { LoggedInDashboard } from '@/components/home/LoggedInDashboard'

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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 p-6 text-center">
      <BrandMark size={56} />
      <h1 className="text-4xl font-bold tracking-tight text-x-cyan-text dark:text-x-cyan">
        BeybladeX.de
      </h1>
      <p className="text-lg font-medium">
        Die Plattform für Beyblade X Turniere in der DACH-Region.
      </p>
      <p className="max-w-xl text-current/70">
        Finde Events und Clubs in deiner Nähe, verwalte deine Sammlung und deine
        Decks — und tritt gegen andere Blader an.
        {/* TODO(Phase 3): upcoming DACH events teaser goes here, reusing the /events query. */}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/register"
          className="rounded-md bg-x-cyan px-6 py-3 font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
        >
          Jetzt registrieren
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-current/30 px-6 py-3 font-medium transition-colors hover:bg-current/5"
        >
          Anmelden
        </Link>
      </div>
    </main>
  )
}
