-- Phase 15 — Rating-Based Seeding. Additive: TournamentParticipant.seed, nullable (null = use
-- the organizer's chosen auto method). Every existing row defaults to null, preserving today's
-- bracket-generation behavior exactly (userId-ascending tie-break) until an organizer opts in.

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN "seed" INTEGER;
