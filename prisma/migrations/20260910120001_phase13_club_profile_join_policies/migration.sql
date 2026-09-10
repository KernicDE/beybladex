-- Phase 13: Club profile fields (websiteUrl, discordUrl) and join policies.
-- Enum defaults preserve today's behavior for every existing row: clubs become OPEN
-- (immediate join) and existing memberships stay ACTIVE (no backfill needed).

-- CreateEnum
CREATE TYPE "ClubJoinPolicy" AS ENUM ('OPEN', 'APPLICATION', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "ClubMemberStatus" AS ENUM ('ACTIVE', 'PENDING_APPLICATION', 'PENDING_INVITE');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "discordUrl" TEXT,
ADD COLUMN     "joinPolicy" "ClubJoinPolicy" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "ClubMember" ADD COLUMN     "status" "ClubMemberStatus" NOT NULL DEFAULT 'ACTIVE';
