-- CreateEnum
CREATE TYPE "Manufacturer" AS ENUM ('TT', 'HASBRO');

-- CreateEnum
CREATE TYPE "PartCategory" AS ENUM ('BLADE', 'RATCHET', 'BIT', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "SpinDirection" AS ENUM ('RIGHT', 'LEFT');

-- CreateEnum
CREATE TYPE "PartRequestStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "DeckBuild" DROP CONSTRAINT "DeckBuild_pkey",
ADD CONSTRAINT "DeckBuild_pkey" PRIMARY KEY ("deckId", "position");

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" "Manufacturer" NOT NULL,
    "category" "PartCategory" NOT NULL,
    "beyType" "BeyType",
    "spinDirection" "SpinDirection" NOT NULL,
    "weightGrams" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturerGuess" "Manufacturer",
    "notes" TEXT,
    "status" "PartRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Part_category_name_idx" ON "Part"("category", "name");

-- CreateIndex
CREATE INDEX "PartRequest_status_createdAt_idx" ON "PartRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Build_bladeId_idx" ON "Build"("bladeId");

-- CreateIndex
CREATE INDEX "Build_ratchetId_idx" ON "Build"("ratchetId");

-- CreateIndex
CREATE INDEX "Build_bitId_idx" ON "Build"("bitId");

-- CreateIndex
CREATE UNIQUE INDEX "DeckBuild_deckId_buildId_key" ON "DeckBuild"("deckId", "buildId");

-- CreateIndex
CREATE INDEX "CollectionItem_partOrBeyId_idx" ON "CollectionItem"("partOrBeyId");

-- CreateIndex
CREATE INDEX "Rating_buildId_createdAt_idx" ON "Rating"("buildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_buildId_userId_key" ON "Rating"("buildId", "userId");

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_bladeId_fkey" FOREIGN KEY ("bladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_ratchetId_fkey" FOREIGN KEY ("ratchetId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_bitId_fkey" FOREIGN KEY ("bitId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_partOrBeyId_fkey" FOREIGN KEY ("partOrBeyId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

