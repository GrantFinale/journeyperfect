-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('FERRY', 'TRAIN', 'BUS');

-- AlterEnum
ALTER TYPE "ItineraryItemType" ADD VALUE 'TRANSPORT';

-- AlterTable: reusable home address on User (prefills each new trip's origin)
ALTER TABLE "User" ADD COLUMN "homeAddress" TEXT,
ADD COLUMN "homeCity" TEXT,
ADD COLUMN "homeLat" DOUBLE PRECISION,
ADD COLUMN "homeLng" DOUBLE PRECISION;

-- AlterTable: per-trip origin (overridable) + own vehicle
ALTER TABLE "Trip" ADD COLUMN "originAddress" TEXT,
ADD COLUMN "originLabel" TEXT,
ADD COLUMN "originLat" DOUBLE PRECISION,
ADD COLUMN "originLng" DOUBLE PRECISION,
ADD COLUMN "vehicleId" TEXT;

-- AlterTable: city awareness + Google Places photos on Hotel
ALTER TABLE "Hotel" ADD COLUMN "city" TEXT,
ADD COLUMN "googlePlaceId" TEXT,
ADD COLUMN "photoRef" TEXT;

-- AlterTable: arrive-early buffer on Flight
ALTER TABLE "Flight" ADD COLUMN "checkInMinsBefore" INTEGER;

-- AlterTable: meal-slot capture on Activity
ALTER TABLE "Activity" ADD COLUMN "mealSlots" TEXT;

-- AlterTable: itinerary items can link to a transport segment
ALTER TABLE "ItineraryItem" ADD COLUMN "transportSegmentId" TEXT;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "licensePlate" TEXT,
    "licensePlateState" TEXT,
    "nickname" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportSegment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "mode" "TransportMode" NOT NULL,
    "operator" TEXT NOT NULL,
    "serviceNumber" TEXT,
    "departureLocation" TEXT NOT NULL,
    "departureTerminal" TEXT,
    "departureAddress" TEXT,
    "departureLat" DOUBLE PRECISION,
    "departureLng" DOUBLE PRECISION,
    "departureTime" TIMESTAMP(3) NOT NULL,
    "departureTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "arrivalLocation" TEXT,
    "arrivalTerminal" TEXT,
    "arrivalAddress" TEXT,
    "arrivalLat" DOUBLE PRECISION,
    "arrivalLng" DOUBLE PRECISION,
    "arrivalTime" TIMESTAMP(3),
    "arrivalTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "confirmationNumber" TEXT,
    "bookingLink" TEXT,
    "seatInfo" TEXT,
    "vehicleOnBoard" BOOLEAN NOT NULL DEFAULT false,
    "passengerCount" INTEGER,
    "checkInMinsBefore" INTEGER,
    "price" DOUBLE PRECISION,
    "priceCurrency" TEXT DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_userId_idx" ON "Vehicle"("userId");

-- CreateIndex
CREATE INDEX "TransportSegment_tripId_idx" ON "TransportSegment"("tripId");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_idx" ON "Trip"("vehicleId");

-- CreateIndex
CREATE INDEX "ItineraryItem_transportSegmentId_idx" ON "ItineraryItem"("transportSegmentId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSegment" ADD CONSTRAINT "TransportSegment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_transportSegmentId_fkey" FOREIGN KEY ("transportSegmentId") REFERENCES "TransportSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
