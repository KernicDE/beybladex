-- CreateTable
CREATE TABLE "ClubMessage" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClubMessage" ADD CONSTRAINT "ClubMessage_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ClubMessage_clubId_createdAt_idx" ON "ClubMessage"("clubId", "createdAt");
