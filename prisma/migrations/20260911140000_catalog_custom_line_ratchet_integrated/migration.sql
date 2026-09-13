-- RC16 (#122) — Katalog-Schema für Custom Line (CX) und Ratchet-Integrated Blades.
--
-- 1. PartCategory erweitert um die vier CX-Teil-Kategorien (Lock Chip + Over Blade +
--    Metal Blade + Assist Blade). Die Reihenfolge der ADD VALUEs ist die Enum-Reihenfolge
--    aus schema.prisma (Postgres hängt neue Werte an).
-- 2. Part.isRatchetIntegrated — Blade-Teile, die physisch das Ratchet enthalten.
-- 3. Build bekommt die vier CX-Slots als nullable FKs; bladeId und ratchetId werden nullable
--    (CX-Builds haben kein einzelnes BLADE-Teil; Ratchet-Integrated-Builds kein RATCHET-Teil).
--    Die Genau-eine-Blade-Form- und Ratchet-Regeln erzwingt lib/buildInput.ts, nicht die DB.
-- 4. Die Phase-20-Unique-Constraint (bladeId, ratchetId, bitId) ersetzt durch den NULL-sicheren
--    Expression-Unique-Index "Build_combo_key" über ALLE sieben Slot-Spalten (COALESCE ''), damit
--    auch 2-Slot- (Ratchet-Integrated) und 6-Slot-Builds (CX) deduplizieren. Bestehende Rows
--    haben überall belegte Standard-Slots → der Index baut ohne Konflikt. Prisma-Schema trägt
--    dafür bewusst KEIN @@unique (nicht darstellbar), siehe Kommentar am Build-Modell.

-- AlterEnum
ALTER TYPE "PartCategory" ADD VALUE 'LOCK_CHIP';
ALTER TYPE "PartCategory" ADD VALUE 'OVER_BLADE';
ALTER TYPE "PartCategory" ADD VALUE 'METAL_BLADE';
ALTER TYPE "PartCategory" ADD VALUE 'ASSIST_BLADE';

-- AlterTable (Part)
ALTER TABLE "Part" ADD COLUMN "isRatchetIntegrated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (Build) — neue CX-Slots
ALTER TABLE "Build" ADD COLUMN "lockChipId" TEXT,
ADD COLUMN "overBladeId" TEXT,
ADD COLUMN "metalBladeId" TEXT,
ADD COLUMN "assistBladeId" TEXT;

-- AlterTable (Build) — bladeId/ratchetId nullable (CX- bzw. Ratchet-Integrated-Builds)
ALTER TABLE "Build" ALTER COLUMN "bladeId" DROP NOT NULL,
ALTER COLUMN "ratchetId" DROP NOT NULL;

-- CreateIndex (Slot-FKs, symmetrisch zu den bestehenden Build_bladeId_idx o. ä.)
CREATE INDEX "Build_lockChipId_idx" ON "Build"("lockChipId");
CREATE INDEX "Build_overBladeId_idx" ON "Build"("overBladeId");
CREATE INDEX "Build_metalBladeId_idx" ON "Build"("metalBladeId");
CREATE INDEX "Build_assistBladeId_idx" ON "Build"("assistBladeId");

-- AddForeignKey (CX-Slots, gleiche Restrict-Semantik wie die Standard-Slots)
ALTER TABLE "Build" ADD CONSTRAINT "Build_lockChipId_fkey" FOREIGN KEY ("lockChipId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_overBladeId_fkey" FOREIGN KEY ("overBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_metalBladeId_fkey" FOREIGN KEY ("metalBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_assistBladeId_fkey" FOREIGN KEY ("assistBladeId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase-20-Unique-Constraint ersetzen durch den NULL-sicheren Expression-Index über alle Slots
ALTER TABLE "Build" DROP CONSTRAINT "Build_bladeId_ratchetId_bitId_key";
CREATE UNIQUE INDEX "Build_combo_key" ON "Build"(
  COALESCE("bladeId", ''),
  COALESCE("lockChipId", ''),
  COALESCE("overBladeId", ''),
  COALESCE("metalBladeId", ''),
  COALESCE("assistBladeId", ''),
  COALESCE("ratchetId", ''),
  COALESCE("bitId", '')
);
