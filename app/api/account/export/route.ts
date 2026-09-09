// app/api/account/export/route.ts
// GET, owner-only — GDPR Art. 20 data portability. Assembles one machine-readable JSON document
// covering every User-owned category. Collection/Deck/Friendship/ClubMember/TournamentParticipant
// queries are written against the real schema; Phase 5 Part A added the userId-scoped Rating
// and PartRequest queries below (both models became User-owned with that phase).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const [user, collection, decks, ratings, partRequests, friendships, clubMemberships, tournamentParticipations] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.collectionItem.findMany({ where: { userId }, include: { pricePoints: true } }),
      prisma.deck.findMany({ where: { userId }, include: { builds: true } }),
      prisma.rating.findMany({ where: { userId } }),
      prisma.partRequest.findMany({ where: { requestedById: userId } }),
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
    ratings,
    partRequests,
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
