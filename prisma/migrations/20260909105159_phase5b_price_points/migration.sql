-- CreateTable
CREATE TABLE "PricePoint" (
    "id" TEXT NOT NULL,
    "collectionItemId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricePoint_collectionItemId_recordedAt_idx" ON "PricePoint"("collectionItemId", "recordedAt");

-- AddForeignKey
ALTER TABLE "PricePoint" ADD CONSTRAINT "PricePoint_collectionItemId_fkey" FOREIGN KEY ("collectionItemId") REFERENCES "CollectionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

