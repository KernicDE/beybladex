// lib/accountErasure.ts (excerpt — the erasure/anonymization matrix, Art. 17 compliant)
import { prisma } from '@/lib/db'

export async function eraseOrAnonymizeUser(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // The original username for the audit summary — gone once the row is anonymized below.
    const originalUsername = (await tx.user.findUnique({ where: { id: userId }, select: { username: true } }))?.username ?? userId

    // Cascade-delete: purely personal, no other user's legitimate interest in keeping it.
    await tx.passkey.deleteMany({ where: { userId } })
    await tx.notification.deleteMany({ where: { userId } })
    await tx.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } })
    await tx.clubMember.deleteMany({ where: { userId } })
    // Phase 5 Part B: PricePoint rows are onDelete: Cascade with their CollectionItem, so the
    // DB would remove them anyway — the explicit deleteMany keeps the erasure matrix
    // self-documenting (standing guard: a new User-owned model ships with its entry) and must
    // run BEFORE the parent rows below.
    const collectionItemIds = (await tx.collectionItem.findMany({ where: { userId }, select: { id: true } })).map((i) => i.id)
    await tx.pricePoint.deleteMany({ where: { collectionItemId: { in: collectionItemIds } } })
    await tx.collectionItem.deleteMany({ where: { userId } })
    // Phase 5 Part A: ratings and part requests are personal and die with the account
    // (Rating.userId arrived with this phase; the onDelete: Cascade is the backstop — the
    // explicit deleteMany keeps the erasure matrix self-documenting, per the Cross-Phase
    // Regression Guard's standing rule that a new User-owned model ships with its entry).
    await tx.rating.deleteMany({ where: { userId } })
    // Phase 11: catalog proposals are personal and die with the account (Cascade backstop,
    // explicit deleteMany for the same self-documenting reason as above). MediaAsset rows are
    // different — a real catalog image (a Part/Build/Tournament's picture) must survive the
    // uploader's own erasure (uploadedById is a plain String, not a FK, per that model's own
    // comment) — sever the reference with a tombstone value instead of deleting the row, so an
    // unrelated user's account deletion never makes a live catalog photo vanish.
    await tx.catalogProposal.deleteMany({ where: { submittedById: userId } })
    await tx.mediaAsset.updateMany({ where: { uploadedById: userId }, data: { uploadedById: `geloescht_${userId.slice(0, 8)}` } })
    // Phase 12: ClubMessage rows are NOT deleted on account erasure — authorId is a plain
    // string column (same pattern as AuditLog.actorId), so the personal link is severed by the
    // User row's own anonymization below while the messages survive for the other club
    // members (Art. 17(3): erasing them would let a user retroactively delete chat history
    // other members already read). Anonymization rewrites displayName/username, which is what
    // the chat renders.
    // Decks/builds a user made: delete the deck join rows and the deck itself (builds are shared
    // catalog-adjacent rows referenced by other decks/matches too — never delete Build itself here).
    const decks = await tx.deck.findMany({ where: { userId }, select: { id: true } })
    await tx.deckBuild.deleteMany({ where: { deckId: { in: decks.map((d) => d.id) } } })
    await tx.deck.deleteMany({ where: { userId } })

    // Anonymize-and-sever: OTHER data subjects (opponents, club members, tournament history) have
    // a legitimate interest in this data surviving — Art. 17(3) — so it stays, stripped of the
    // personal link. `username` is released (it's @unique) so it can be re-registered by someone else.
    const anonymizedUsername = `geloescht_${userId.slice(0, 8)}`
    await tx.user.update({
      where: { id: userId },
      data: {
        username: anonymizedUsername, displayName: 'Gelöschter Nutzer', email: null, passwordHash: null,
        // Phase 19: displayNameNormalized is @unique, so the shared tombstone displayName must not
        // be stored with its shared normalized form ('gelöschter nutzer' would collide on the
        // SECOND erased user and abort the whole erasure with P2002). The tombstone is a system
        // placeholder, not a user-chosen display name — store a per-user unique normalized value
        // (both columns still written together) so erasure stays repeatable for every account.
        displayNameNormalized: `gelöschter nutzer ${userId}`,
        bio: null, discordTag: null, city: null, postalCode: null, latitude: null, longitude: null,
        birthDate: null, totpSecret: null, parentalConsentEmail: null,
      },
    })
    // Club ownership can't dangle (onDelete: Restrict in spec §3) — reassign to another admin
    // member, or dissolve the club if the departing owner was its only member.
    const ownedClubs = await tx.club.findMany({ where: { ownerId: userId }, include: { members: { where: { isAdmin: true, status: 'ACTIVE', userId: { not: userId } } } } })
    for (const club of ownedClubs) {
      if (club.members[0]) await tx.club.update({ where: { id: club.id }, data: { ownerId: club.members[0].userId } })
      else await tx.club.delete({ where: { id: club.id } }) // no other admin — dissolve
    }
    // Rulesets a user authored stay (other organizers/tournaments reference them) — reassign to a
    // reserved system user rather than leaving a dangling createdById.
    const systemUser = await tx.user.upsert({ where: { username: 'geloeschte-nutzer' }, create: { username: 'geloeschte-nutzer', role: 'USER' }, update: {} })
    await tx.ruleset.updateMany({ where: { createdById: userId }, data: { createdById: systemUser.id } })
    // Tournaments a user organized stay as well — participants have a legitimate interest in the
    // event record (Art. 17(3)) — so ownership is reassigned to the same reserved system user
    // (the createdBy FK has no cascade; without this the user delete would fail on Restrict).
    await tx.tournament.updateMany({ where: { createdById: userId }, data: { createdById: systemUser.id } })
    // Match/TournamentParticipant/judged-Match references: personal link severed by the User row's
    // own anonymization above (player1Id/player2Id/judgeId still point at the now-anonymized row —
    // spec §3 has no cascade there and none is needed; the row itself carries no PII anymore).
    // TournamentParticipant rows are kept for the same Art. 17(3) reason: a tournament's
    // participant history legitimately outlives one participant's account.
    // Phase 14: PlayerRating.userId (a real FK, see that model's own schema comment) needs no
    // action here for the same reason — the row survives with the now-anonymized User row still
    // attached, exactly like Match.player1Id above; the public ladder simply renders
    // "Gelöschter Nutzer" for that entry instead of disappearing (a season's leaderboard/rank
    // history has genuine aggregate value beyond the individual, same judgment call as
    // AuditLog/ClubMessage).

    // Audit trail (Phase 4, [REVIEW-FIX: privacy-dsgvo #8]): append-only, actor is the account
    // owner acting on themselves. actorId is a plain string column — the log must outlive the
    // (anonymized-in-place, never deleted) user row.
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'account.delete',
        targetType: 'user',
        targetId: userId,
        summary: `Konto @${originalUsername} gelöscht und anonymisiert`,
      },
    })
  })
  // Session/token invalidation: KNOWN GAP — the plan calls for bumping a `tokenVersion` field so
  // existing 30-day JWTs stop authenticating immediately after erasure. That field is additive to
  // User and paired with the backend review's open token-revocation item, which has NOT been
  // implemented yet in this codebase. Until it lands, a session cookie issued before erasure can
  // technically still authenticate against the anonymized row (which no longer carries PII or
  // credentials, so no data is exposed, but the session is not revoked). Add the bump here when
  // tokenVersion exists — do not invent the field from this task.
}
