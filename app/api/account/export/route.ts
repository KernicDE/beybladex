// app/api/account/export/route.ts
// GET, owner-only — GDPR Art. 20 data portability. Assembles one machine-readable JSON document
// covering every User-owned category. Collection/Deck/Friendship/ClubMember/TournamentParticipant
// models exist since Task 3 but have no feature UI yet (Phases 3–5) — users naturally return
// empty arrays for those categories today; the queries are written against the real schema so
// the export is forward-compatible with the later phases that start writing rows.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const [user, collection, decks, friendships, clubMemberships, tournamentParticipations] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.collectionItem.findMany({ where: { userId } }),
      prisma.deck.findMany({ where: { userId }, include: { builds: true } }),
      prisma.friendship.findMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      prisma.clubMember.findMany({ where: { userId }, include: { club: true } }),
      prisma.tournamentParticipant.findMany({ where: { userId }, include: { tournament: true } }),
    ])
  if (!user) return Response.json({ error: 'not_found' }, { status: 404 })

  const document = {
    exportedAt: new Date().toISOString(),
    profile: {
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      bio: user.bio,
      birthDate: user.birthDate,
      isMinor: user.isMinor,
      city: user.city,
      postalCode: user.postalCode,
      state: user.state,
      country: user.country,
      discordTag: user.discordTag,
      profileVisibility: user.profileVisibility,
      locationVisibility: user.locationVisibility,
      collectionVisibility: user.collectionVisibility,
      decksVisibility: user.decksVisibility,
      ageVisibility: user.ageVisibility,
      createdAt: user.createdAt,
    },
    collection,
    decks,
    // NOTE: Rating has no userId yet at Phase 1 (spec §3's Rating is anonymous) — a user's own
    // ratings become exportable when Phase 5 Part A adds Rating.userId; see lib/accountErasure.ts
    // for the paired erasure-matrix entry. Empty until then, never another user's data.
    ratings: [] as unknown[],
    friendships,
    clubMemberships,
    notificationPreferences: {
      notifyRadiusKm: user.notifyRadiusKm,
      notifyRecurring: user.notifyRecurring,
      notifyEmail: user.notifyEmail,
    },
    tournamentParticipations,
  }

  return Response.json(document, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="beybladex-export-${user.username}.json"`,
    },
  })
}
