-- CreateTable
CREATE TABLE "DismissedPlace" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "googlePlaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DismissedPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DismissedPlace_tripId_googlePlaceId_key" ON "DismissedPlace"("tripId", "googlePlaceId");

-- CreateIndex
CREATE INDEX "DismissedPlace_tripId_idx" ON "DismissedPlace"("tripId");

-- AddForeignKey
ALTER TABLE "DismissedPlace" ADD CONSTRAINT "DismissedPlace_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
