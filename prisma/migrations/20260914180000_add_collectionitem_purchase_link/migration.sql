-- Issue #169 ("Teile werden nicht mit Beyblade gelöscht") — CollectionItem.purchaseId: welche
-- Purchase-Zeile diesen Eintrag erzeugt hat (siehe schema.prisma-Kommentar für die Begründung
-- gegenüber dem bereits bestehenden sourceBeybladeId). ON DELETE CASCADE — löscht man den Kauf,
-- sollen auch dessen Teile aus der Sammlung verschwinden (PricePoints hängen bereits kaskadierend
-- an CollectionItem, siehe deren eigenes onDelete: Cascade).
-- AlterTable
ALTER TABLE "CollectionItem" ADD COLUMN "purchaseId" TEXT;

-- CreateIndex
CREATE INDEX "CollectionItem_purchaseId_idx" ON "CollectionItem"("purchaseId");

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
