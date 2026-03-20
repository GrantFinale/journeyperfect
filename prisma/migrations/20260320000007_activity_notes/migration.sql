-- AlterTable
ALTER TABLE "ItineraryItem" ADD COLUMN "userNotes" TEXT;

-- CreateTable
CREATE TABLE "ActivityNote" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityNote_activityId_idx" ON "ActivityNote"("activityId");

-- AddForeignKey
ALTER TABLE "ActivityNote" ADD CONSTRAINT "ActivityNote_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityNote" ADD CONSTRAINT "ActivityNote_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityNote" ADD CONSTRAINT "ActivityNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
