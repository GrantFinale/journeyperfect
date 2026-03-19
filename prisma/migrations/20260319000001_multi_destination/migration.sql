-- CreateTable
CREATE TABLE "TripDestination" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripDestination_tripId_idx" ON "TripDestination"("tripId");

-- AddForeignKey
ALTER TABLE "TripDestination" ADD CONSTRAINT "TripDestination_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: Seed TripDestination from existing Trip.destination
INSERT INTO "TripDestination" ("id", "tripId", "name", "lat", "lng", "position", "createdAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "destination",
    "destinationLat",
    "destinationLng",
    0,
    NOW()
FROM "Trip"
WHERE "destination" IS NOT NULL AND "destination" != '';
