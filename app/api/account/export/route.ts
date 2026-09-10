// app/api/account/export/route.ts
// GET, owner-only — GDPR Art. 20 data portability. Assembles one machine-readable JSON document
// covering every User-owned category. Collection/Deck/Friendship/ClubMember/TournamentParticipant
// queries are written against the real schema; Phase 5 Part A added the userId-scoped Rating
// query; Phase 11 replaced PartRequest with CatalogProposal (submittedById) and added
// MediaAsset (uploadedById); Phase 12 adds authored club-chat messages (scoped by the
// plain-string authorId — see lib/accountErasure.ts). All User-owned per the standing rule.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const [user, collection, decks, ratings, catalogProposals, mediaAssets, friendships, clubMemberships, tournamentParticipations, stageStandings, clubMessages] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.collectionItem.findMany({ where: { userId }, include: { pricePoints: true } }),
      prisma.deck.findMany({ where: { userId }, include: { builds: true } }),
      prisma.rating.findMany({ where: { userId } }),
      prisma.catalogProposal.findMany({ where: { submittedById: userId } }),
      prisma.mediaAsset.findMany({ where: { uploadedById: userId }, select: { id: true, filename: true, mimeType: true, width: true, height: true, createdAt: true } }),
      prisma.friendship.findMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      prisma.clubMember.findMany({ where: { userId }, include: { club: true } }),
      prisma.tournamentParticipant.findMany({ where: { userId }, include: { tournament: true } }),
      // Phase 5 Part C2 — User-owned per-stage tournament record (erasure: cascade on user delete).
      prisma.stageStanding.findMany({ where: { userId }, include: { stage: { select: { name: true, format: true, tournamentId: true } } } }),
      // Phase 12 — authored club-chat messages (erasure: rows survive author erasure,
      // authorId is a plain string column, so the query scopes by authorId, not a User FK).
      prisma.clubMessage.findMany({ where: { authorId: userId } }),
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
    catalogProposals,
    mediaAssets,
    friendships,
    clubMemberships,
    notificationPreferences: {
      notifyRadiusKm: user.notifyRadiusKm,
      notifyRecurring: user.notifyRecurring,
      notifyEmail: user.notifyEmail,
    },
    tournamentParticipations,
    stageStandings,
    clubMessages,
  }

  return Response.json(document, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="beybladex-export-${user.username}.json"`,
    },
  })
}
