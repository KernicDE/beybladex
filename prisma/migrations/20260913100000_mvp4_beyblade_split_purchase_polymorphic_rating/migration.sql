-- MVP4 (#139/#141) — Beyblade-Modell, Purchase, polymorphes Rating, Build-Split.
--
-- Architektur dieses Backfills (KEINE Nutzerdaten — es gibt noch keine Nutzer):
--   1. Beyblade-Tabelle anlegen.
--   2. Jeden Build mit isOfficialSet=true als Beyblade-Zeile NEU anlegen — mit DERSELBEN id,
--      damit bestehende Verweise (CollectionItem.sourceBuildId, Ratings auf Sets) nahtlos auf
--      die Beyblade-Zeile zeigen. manufacturer kommt aus dem Blade-Teil (bzw. Lock Chip bei
--      Custom Line) — ein Build hatte keine eigene manufacturer-Spalte; productCode/name/
--      imageId/Slots werden 1:1 übernommen.
--   3. Ratings polymorph machen: bestehende Build-Ratings werden (targetType=BUILD,
--      targetId=buildId); Ratings auf offiziellen Sets werden BEYBLADE-Ratings (die Beyblade
--      trägt die alte Build-id).
--   4. CollectionItem.sourceBuildId → sourceBeybladeId umbenennen (Werte bleiben — id-Reuse).
--   5. Die isOfficialSet-Builds löschen, dann isOfficialSet/productCode aus Build entfernen
--      und visibility (PUBLIC|UNLISTED, Default UNLISTED) ergänzen.
--   6. Beyblade_combo_key: handschriftlicher NULL-sicherer Unique-Index über alle 7 Slots
--      (COALESCE ''), analog Build_combo_key — nicht deklarativ darstellbar. Der Backfill kann
--      nicht kollidieren: dieselbe Kombination konnte vorher schon nicht zwei Build-Rows
--      tragen (Build_combo_key), also auch nicht zwei offizielle Sets.

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED');

-- CreateEnum
CREATE TYPE "RatingTargetType" AS ENUM ('BEYBLADE', 'BUILD', 'PART');

-- CreateTable
CREATE TABLE "Beyblade" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" "Manufacturer" NOT NULL,
    "productCode" TEXT,
    "imageId" TEXT,
    "bladeId" TEXT,
    "lockChipId" TEXT,
    "overBladeId" TEXT,
    "metalBladeId" TEXT,
    "assistBladeId" TEXT,
    "ratchetId" TEXT,
    "bitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beyblade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "beybladeId" TEXT NOT NULL,
    "merchant" TEXT,
    "boughtAt" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- Backfill (Schritt 2): offizielle Sets → Beyblade-Zeilen, id-Reuse, manufacturer aus dem
-- Blade-Teil (Standard/Ratchet-Integrated) bzw. Lock Chip (Custom Line); 'TT' als letzte
-- Sicherheit — produktiv sind alle Sets vollständig katalogisiert.
INSERT INTO "Beyblade" ("id", "name", "manufacturer", "productCode", "imageId", "bladeId", "lockChipId", "overBladeId", "metalBladeId", "assistBladeId", "ratchetId", "bitId", "createdAt", "updatedAt")
SELECT b."id",
       COALESCE(b."name", 'Set ' || b."id"),
       COALESCE(blade."manufacturer", lockchip."manufacturer", 'TT'),
       b."productCode",
       b."imageId",
       b."bladeId", b."lockChipId", b."overBladeId", b."metalBladeId", b."assistBladeId", b."ratchetId", b."bitId",
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Build" b
LEFT JOIN "Part" blade ON blade."id" = b."bladeId"
LEFT JOIN "Part" lockchip ON lockchip."id" = b."lockChipId"
WHERE b."isOfficialSet" = true;

-- DropForeignKey
ALTER TABLE "CollectionItem" DROP CONSTRAINT "CollectionItem_sourceBuildId_fkey";

-- DropForeignKey
ALTER TABLE "Rating" DROP CONSTRAINT "Rating_buildId_fkey";

-- DropIndex
DROP INDEX "Build_productCode_key";

-- DropIndex
DROP INDEX "Rating_buildId_createdAt_idx";

-- DropIndex
DROP INDEX "Rating_buildId_userId_key";

-- AlterTable (Schritt 4): Provenance-Spalte umbenennen — die Werte zeigen mit dem id-Reuse
-- ab sofort auf die Beyblade-Zeilen.
ALTER TABLE "CollectionItem" RENAME COLUMN "sourceBuildId" TO "sourceBeybladeId";

-- AlterTable (Schritt 3): Rating polymorph machen. Ratings auf offiziellen Sets (die jetzt
-- Beyblade-Zeilen mit derselben id sind) werden BEYBLADE-Ratings, alle anderen BUILD-Ratings.
ALTER TABLE "Rating" ADD COLUMN "targetId" TEXT,
ADD COLUMN "targetType" "RatingTargetType";

UPDATE "Rating" r
SET "targetId" = r."buildId",
    "targetType" = CASE WHEN b."isOfficialSet" THEN 'BEYBLADE'::"RatingTargetType" ELSE 'BUILD'::"RatingTargetType" END
FROM "Build" b
WHERE b."id" = r."buildId";

ALTER TABLE "Rating" ALTER COLUMN "targetId" SET NOT NULL,
ALTER COLUMN "targetType" SET NOT NULL;

-- AlterTable
ALTER TABLE "Build" ADD COLUMN     "visibility" "Visibility" NOT NULL DEFAULT 'UNLISTED';

-- Schritt 5: die umgezogenen offiziellen Sets löschen, dann ihre Spalten entfernen.
DELETE FROM "Build" WHERE "isOfficialSet" = true;

ALTER TABLE "Build" DROP COLUMN "isOfficialSet",
DROP COLUMN "productCode";

-- AlterTable
ALTER TABLE "Rating" DROP COLUMN "buildId";

-- CreateIndex
CREATE UNIQUE INDEX "Beyblade_productCode_key" ON "Beyblade"("productCode");

-- CreateIndex
CREATE INDEX "Beyblade_bladeId_idx" ON "Beyblade"("bladeId");

-- CreateIndex
CREATE INDEX "Beyblade_lockChipId_idx" ON "Beyblade"("lockChipId");

-- CreateIndex
CREATE INDEX "Beyblade_overBladeId_idx" ON "Beyblade"("overBladeId");

-- CreateIndex
CREATE INDEX "Beyblade_metalBladeId_idx" ON "Beyblade"("metalBladeId");

-- CreateIndex
CREATE INDEX "Beyblade_assistBladeId_idx" ON "Beyblade"("assistBladeId");

-- CreateIndex
CREATE INDEX "Beyblade_ratchetId_idx" ON "Beyblade"("ratchetId");

-- CreateIndex
CREATE INDEX "Beyblade_bitId_idx" ON "Beyblade"("bitId");

-- Beyblade_combo_key (Schritt 6): NULL-sicherer Unique-Index über alle 7 Slots, analog
-- Build_combo_key — Prisma kann COALESCE-Ausdrücke nicht deklarativ ausdrücken.
CREATE UNIQUE INDEX "Beyblade_combo_key" ON "Beyblade"(
  COALESCE("bladeId", ''),
  COALESCE("lockChipId", ''),
  COALESCE("overBladeId", ''),
  COALESCE("metalBladeId", ''),
  COALESCE("assistBladeId", ''),
  COALESCE("ratchetId", ''),
  "bitId"
);

-- CreateIndex
CREATE INDEX "Purchase_beybladeId_createdAt_idx" ON "Purchase"("beybladeId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Rating_targetType_targetId_createdAt_idx" ON "Rating"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_targetType_targetId_userId_key" ON "Rating"("targetType", "targetId", "userId");

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_bladeId_fkey" FOREIGN KEY ("bladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_lockChipId_fkey" FOREIGN KEY ("lockChipId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_overBladeId_fkey" FOREIGN KEY ("overBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_metalBladeId_fkey" FOREIGN KEY ("metalBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_assistBladeId_fkey" FOREIGN KEY ("assistBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_ratchetId_fkey" FOREIGN KEY ("ratchetId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beyblade" ADD CONSTRAINT "Beyblade_bitId_fkey" FOREIGN KEY ("bitId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_beybladeId_fkey" FOREIGN KEY ("beybladeId") REFERENCES "Beyblade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_sourceBeybladeId_fkey" FOREIGN KEY ("sourceBeybladeId") REFERENCES "Beyblade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
