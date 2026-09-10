-- Phase 11 — generic media pipeline, catalog proposals (replaces PartRequest), official Sets
-- and collection-linked availability.
--
-- PartRequest is REAL and LIVE (Phase 5 Part A): existing rows are backfilled into
-- CatalogProposal as kind='PART' payloads (PENDING→PENDING, RESOLVED→APPROVED,
-- REJECTED→REJECTED) before the table is dropped — a genuine migration, not a no-op.
-- Part.imageUrl is dropped (never referenced real files — seeded values were null; catalog
-- images are re-uploaded through the MediaAsset pipeline from this phase on).

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('PART', 'BUILD');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogProposal" (
    "id" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "imageAssetId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogProposal_pkey" PRIMARY KEY ("id")
);

-- Backfill: migrate every live PartRequest row into a CatalogProposal before dropping the table.
INSERT INTO "CatalogProposal" ("id", "kind", "submittedById", "payload", "status", "createdAt")
SELECT
    "id",
    'PART',
    "requestedById",
    jsonb_build_object(
        'name', "name",
        'manufacturerGuess', "manufacturerGuess",
        'notes', "notes"
    ),
    CASE "status" WHEN 'RESOLVED' THEN 'APPROVED'::"ProposalStatus" ELSE "status"::"ProposalStatus" END,
    "createdAt"
FROM "PartRequest";

-- CreateIndex
CREATE INDEX "CatalogProposal_status_createdAt_idx" ON "CatalogProposal"("status", "createdAt");

-- MediaAsset.uploadedById is deliberately NOT a foreign key (see the model's schema.prisma
-- comment — same reasoning as AuditLog.actorId/ClubMessage.authorId): a real catalog image
-- must survive its uploader's account erasure, so there is no FK constraint to add here.

-- AddForeignKey
ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (Part.imageUrl -> Part.imageId, a real FK into MediaAsset)
ALTER TABLE "Part" DROP COLUMN "imageUrl",
ADD COLUMN "imageId" TEXT;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (Build: official Sets + image)
ALTER TABLE "Build" ADD COLUMN     "name" TEXT,
ADD COLUMN     "isOfficialSet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageId" TEXT;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (Tournament: event header image)
ALTER TABLE "Tournament" ADD COLUMN     "headerImageId" TEXT;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_headerImageId_fkey" FOREIGN KEY ("headerImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (CollectionItem: Set-purchase provenance)
ALTER TABLE "CollectionItem" ADD COLUMN     "sourceBuildId" TEXT;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_sourceBuildId_fkey" FOREIGN KEY ("sourceBuildId") REFERENCES "Build"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable (PartRequest — replaced by CatalogProposal; rows backfilled above)
DROP TABLE "PartRequest";

-- DropEnum
DROP TYPE "PartRequestStatus";
