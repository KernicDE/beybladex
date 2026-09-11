// app/events/[id]/page.tsx
// Canonical PUBLIC event detail page (Task 13 IA decision): map pin, info, participant
// count/list, and the join flow. A guest sees the same content with "Anmelden, um teilzunehmen"
// in place of the join button. The organizer (or an ADMIN) additionally sees each participant's
// check-in status — the day-of check-in table lives in Phase 5's organizer console; check-in
// itself already works here via PATCH /api/tournaments/[id]/checkin.
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { withPublicCache, publicTournamentKey } from '@/lib/publicCache'
import { formatEventTime } from '@/lib/formatDateTime'
import { stageWinnersRounds } from '@/lib/bracket'
import { getDictionary, getLocale } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/locales'
import { MapView } from '@/components/map/MapView'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { JoinPanel } from '@/components/tournament/JoinPanel'
import { TeamJoinPanel } from '@/components/teams/TeamJoinPanel'
import { TournamentShareQR } from '@/components/tournament/TournamentShareQR'
import { JudgeBracketView } from '@/components/judge/JudgeBracketView'

// [RC5 #43] No `revalidate` export: auth() (join flow, organizer badges) forces per-request
// rendering, so an ISR revalidate export never applied. The public tournament query is cached
// in Redis for 60s instead (lib/publicCache.ts). Session-dependent UI still renders per
// request; mutations that change the public payload invalidate the key immediately
// (invalidatePublicCache, hotfix #99), so organizer edits show up without waiting out the TTL.
const PUBLIC_DETAIL_TTL = 60

function formatFee(cent: number, currency: string, locale: Locale, freeLabel: string): string {
  if (cent === 0) return freeLabel
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency }).format(cent / 100)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const [t, locale] = await Promise.all([getDictionary(), getLocale()])
  const [tournament, session] = await Promise.all([
    withPublicCache(publicTournamentKey(id), PUBLIC_DETAIL_TTL, () =>
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
          headerImageId: true,
          // RC15 #12 — team mode changes the registration aggregate and the bracket preview.
          teamMode: true,
          teamEntries: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              checkedIn: true,
              team: { select: { id: true, name: true, slug: true, club: { select: { slug: true, name: true } } } },
              slots: {
                orderBy: { position: 'asc' },
                select: { position: true, userId: true, user: { select: { username: true, displayName: true } } },
              },
            },
          },
          ruleset: { select: { title: true, slug: true } },
          participants: {
            orderBy: { id: 'asc' },
            select: { userId: true, checkedIn: true, user: { select: { username: true, displayName: true } } },
          },
          // Phase 10 item 6 — read-only bracket/standings preview, reusing JudgeBracketView (the
          // same component /tournaments/[id]'s full page uses) instead of a second renderer. Only
          // the LAST stage is shown here — a compact "where things stand" glance; the full
          // multi-stage view remains behind the "Turnierbaum & Judge-Bereich" link below.
          stages: {
            orderBy: { order: 'desc' },
            take: 1,
            include: {
              matches: { orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }] },
              // RC15 #12 — team-mode bracket preview: encounters instead of solo matches.
              teamMatches: {
                orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
                include: {
                  team1Entry: { select: { id: true, team: { select: { name: true } } } },
                  team2Entry: { select: { id: true, team: { select: { name: true } } } },
                },
              },
              standings: {
                orderBy: [{ wins: 'desc' }, { buchholz: 'desc' }],
                include: { user: { select: { username: true, displayName: true } } },
              },
            },
          },
        },
      }),
    ),
    auth(),
  ])
  if (!tournament) notFound()

  // Phase 10 item 6 — participant club affiliation: one grouped query instead of N+1, kept to
  // ACTIVE memberships only (standing rule from lib/clubMembers.ts) and the first membership
  // per user (a participant list badge shows one club, not every one they belong to).
  const participantIds = tournament.participants.map((p) => p.userId)
  const memberships = participantIds.length
    ? await prisma.clubMember.findMany({
        where: { userId: { in: participantIds }, status: 'ACTIVE' },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, club: { select: { slug: true, name: true } } },
      })
    : []
  const clubByUserId = new Map<string, { slug: string; name: string }>()
  for (const m of memberships) {
    if (!clubByUserId.has(m.userId)) clubByUserId.set(m.userId, m.club)
  }

  const now = new Date()
  const me = session?.user?.id
  const caller = me
    ? await prisma.user.findUnique({ where: { id: me }, select: { role: true } })
    : null
  const myParticipation = me
    ? tournament.participants.find((p) => p.userId === me)
    : undefined
  const isOrganizer = me !== undefined && (tournament.createdById === me || caller?.role === 'ADMIN')

  // RC15 #12 — team-mode registration state for the TeamJoinPanel: the viewer's teams (with
  // member counts + captaincy), which of them are already registered, and the viewer's own
  // entry when their team is registered.
  const myTeamRows = me
    ? await prisma.teamMember.findMany({
        where: { userId: me },
        include: {
          team: { include: { members: { select: { userId: true } } } },
        },
      })
    : []
  const myTeams = myTeamRows.map((m) => ({
    id: m.team.id,
    name: m.team.name,
    slug: m.team.slug,
    memberCount: m.team.members.length,
    isCaptain: m.role === 'CAPTAIN',
  }))
  const registeredTeamIds = tournament.teamEntries.map((e) => e.team.id)
  const myEntryRow = me ? tournament.teamEntries.find((e) => e.slots.some((s) => s.userId === me)) : undefined
  const myEntry = myEntryRow
    ? {
        entryId: myEntryRow.id,
        teamId: myEntryRow.team.id,
        teamName: myEntryRow.team.name,
        checkedIn: myEntryRow.checkedIn,
        viewerInLineup: myEntryRow.slots.some((s) => s.userId === me),
      }
    : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      {tournament.headerImageId && (
        // Phase 11 (item 5): full-width event header image via the generic media pipeline.
        // MediaAsset is served at a fixed 1200x400 (EVENT_HEADER_TARGET) — a relatively
        // positioned container + `fill` avoids passing separate width/height here.
        <div className="relative h-48 w-full overflow-hidden rounded-xl sm:h-64">
          <Image src={`/api/media/${tournament.headerImageId}`} alt="" fill sizes="768px" className="object-cover" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{tournament.title}</h1>
        {tournament.isRecurring && <Badge tone="cyan">{t.events.detail.recurring}</Badge>}
      </div>

      <MapView
        className="z-0 h-64 w-full rounded-xl border border-x-cyan/20 sm:h-80"
        center={{ lat: tournament.latitude, lng: tournament.longitude }}
        zoom={13}
        markers={[{ id: tournament.id, lat: tournament.latitude, lng: tournament.longitude, label: tournament.title }]}
      />

      <Card className="space-y-2 p-4 text-sm">
        <p>
          <span className="font-medium">{t.events.detail.time}: </span>
          {/* #81 — ein einziges Datum bei ein-tägigen Turnieren ("Freitag, 11.09.2026 von
              10:30 Uhr bis 17:30 Uhr"); mehrtägig bleiben beide Daten sichtbar. Die
              Tag-Gleichheit prüft formatEventTime in Europe/Berlin, nicht in der Host-Zone. */}
          {formatEventTime(tournament.startDate, tournament.endDate)}
        </p>
        <p>
          <span className="font-medium">{t.events.detail.location}: </span>
          {tournament.locationName}, {tournament.street ? `${tournament.street}, ` : ''}
          {tournament.postalCode} {tournament.city}, {tournament.state} ({tournament.country})
        </p>
        <p>
          <span className="font-medium">{t.events.detail.entry}: </span>
          {formatFee(tournament.entryFeeCent, tournament.currency, locale, t.events.detail.freeEntry)}
        </p>
        <p>
          <span className="font-medium">{t.events.detail.ruleset}: </span>
          <Link href={`/rules/${tournament.ruleset.slug}`} className="text-x-cyan-text hover:underline">
            {tournament.ruleset.title}
          </Link>
        </p>
      </Card>

      <TournamentShareQR tournamentId={tournament.id} />

      {/* Join flow — guests get the sign-in prompt instead of the join button (Task 13 convention). */}
      {!me ? (
        <Link
          href="/login"
          className="inline-block rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          {t.events.detail.joinLogin}
        </Link>
      ) : tournament.teamMode ? (
        <TeamJoinPanel
          tournamentId={tournament.id}
          myTeams={myTeams}
          registeredTeamIds={registeredTeamIds}
          myEntry={myEntry}
          checkInOpen={isSameDay(now, tournament.startDate)}
          canWithdraw={now <= tournament.startDate}
          labels={t.events.teamJoin}
        />
      ) : (
        <JoinPanel
          tournamentId={tournament.id}
          joined={myParticipation !== undefined}
          checkedIn={myParticipation?.checkedIn ?? false}
          checkInOpen={isSameDay(now, tournament.startDate)}
          canWithdraw={now <= tournament.startDate}
          labels={t.events.join}
        />
      )}

      <p className="text-sm">
        <Link href={`/tournaments/${tournament.id}`} className="text-x-cyan-text hover:underline">
          {t.events.detail.bracketLink}
        </Link>
      </p>

      {tournament.teamMode ? (
        <section aria-labelledby="teams-heading" className="space-y-3">
          <h2 id="teams-heading" className="text-lg font-semibold">
            {t.events.detail.teams} ({tournament.teamEntries.length})
          </h2>
          {tournament.teamEntries.length === 0 ? (
            <p className="text-sm text-current/60">{t.events.detail.noTeams}</p>
          ) : (
            <ul className="space-y-2">
              {tournament.teamEntries.map((e) => (
                <li key={e.id} className="rounded-md border border-current/10 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <Link href={`/teams/${e.team.slug}`} className="hover:underline">
                        {e.team.name}
                      </Link>
                      {e.team.club && (
                        <Link href={`/clubs/${e.team.club.slug}`}>
                          <Badge tone="neutral">{e.team.club.name}</Badge>
                        </Link>
                      )}
                    </span>
                    {isOrganizer &&
                      (e.checkedIn ? (
                        <Badge tone="cyan">{t.events.detail.checkedIn}</Badge>
                      ) : (
                        <Badge tone="neutral">{t.events.detail.notCheckedIn}</Badge>
                      ))}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 text-current/70">
                    {e.slots.map((s) => (
                      <Link key={s.position} href={`/profile/${s.user.username}`} className="hover:underline">
                        {s.user.displayName ?? s.user.username}
                      </Link>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
      <section aria-labelledby="participants-heading" className="space-y-3">
        <h2 id="participants-heading" className="text-lg font-semibold">
          {t.events.detail.participants} ({tournament.participants.length})
        </h2>
        {tournament.participants.length === 0 ? (
          <p className="text-sm text-current/60">{t.events.detail.noParticipants}</p>
        ) : (
          <ul className="space-y-2">
            {tournament.participants.map((p) => {
              const club = clubByUserId.get(p.userId)
              return (
                <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/10 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/profile/${p.user.username}`} className="hover:underline">
                      {p.user.displayName ?? p.user.username}
                    </Link>
                    {club && (
                      <Link href={`/clubs/${club.slug}`}>
                        <Badge tone="neutral">{club.name}</Badge>
                      </Link>
                    )}
                    {/* Deck visibility is gated on the target page itself (404 when private) —
                        this link is always shown; a private-decks user just 404s through it,
                        same as any other resolveVisibleFields-gated link on the site. */}
                    <Link href={`/decks/${p.user.username}`} className="text-x-cyan-text hover:underline">
                      {t.events.detail.decks}
                    </Link>
                  </span>
                  {isOrganizer &&
                    (p.checkedIn ? (
                      <Badge tone="cyan">{t.events.detail.checkedIn}</Badge>
                    ) : (
                      <Badge tone="neutral">{t.events.detail.notCheckedIn}</Badge>
                    ))}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      )}

      {tournament.stages.length > 0 &&
        (tournament.teamMode
          ? tournament.stages[0].teamMatches.length > 0
          : tournament.stages[0].matches.length > 0) && (
        <section aria-labelledby="bracket-preview-heading" className="space-y-3">
          <h2 id="bracket-preview-heading" className="text-lg font-semibold">
            {t.events.detail.standings.replace('{stage}', tournament.stages[0].name)}
          </h2>
          {tournament.teamMode ? (
            <JudgeBracketView
              matches={tournament.stages[0].teamMatches.map((m) => ({
                id: m.id,
                round: m.round,
                bracketOrder: m.bracketOrder,
                swissRound: null,
                player1Id: m.team1Entry?.id ?? null,
                player2Id: m.team2Entry?.id ?? null,
                winnerId: m.winnerEntryId,
                status: m.status,
              }))}
              players={tournament.teamEntries.map((e) => ({ id: e.id, name: e.team.name }))}
              format={tournament.stages[0].format}
              wbRounds={stageWinnersRounds(tournament.stages[0].teamMatches)}
              standings={[]}
            />
          ) : (
          <JudgeBracketView
            matches={tournament.stages[0].matches.map((m) => ({
              id: m.id,
              round: m.round,
              bracketOrder: m.bracketOrder,
              swissRound: m.swissRound,
              player1Id: m.player1Id,
              player2Id: m.player2Id,
              winnerId: m.winnerId,
              status: m.status,
            }))}
            players={tournament.participants.map((p) => ({ id: p.userId, name: p.user.displayName ?? p.user.username }))}
            format={tournament.stages[0].format}
            wbRounds={stageWinnersRounds(tournament.stages[0].matches)}
            standings={tournament.stages[0].standings.map((s) => ({
              userId: s.userId,
              name: s.user.displayName ?? s.user.username,
              wins: s.wins,
              losses: s.losses,
              buchholz: s.buchholz,
            }))}
          />
          )}
          <p className="text-sm">
            <Link href={`/tournaments/${tournament.id}`} className="text-x-cyan-text hover:underline">
              {t.events.detail.fullBracketLink}
            </Link>
          </p>
        </section>
      )}

      {tournament.description && (
        <section aria-labelledby="description-heading" className="space-y-2">
          <h2 id="description-heading" className="text-lg font-semibold">
            {t.events.detail.description}
          </h2>
          <MarkdownContent className="text-sm text-current/80">{tournament.description}</MarkdownContent>
        </section>
      )}
    </main>
  )
}
