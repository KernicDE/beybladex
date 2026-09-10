-- Phase 21 — User Avatars & Upload. Additive: User.avatarImageId, an optional FK to
-- MediaAsset (onDelete: SetNull). A user's uploaded profile photo, processed through the
-- generic media pipeline (lib/media.ts, AVATAR_TARGET 256x256) and served by the generic
-- GET /api/media/[id] route. The SetNull is only the backstop — account erasure
-- (lib/accountErasure.ts) explicitly deletes the avatar's MediaAsset row + on-volume file,
-- because an avatar is personal-only data that must not survive its owner's erasure.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarImageId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarImageId_fkey" FOREIGN KEY ("avatarImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
