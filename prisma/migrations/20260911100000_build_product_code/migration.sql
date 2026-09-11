-- AlterTable
ALTER TABLE "Build" ADD COLUMN     "productCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Build_productCode_key" ON "Build"("productCode");
