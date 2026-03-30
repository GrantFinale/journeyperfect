-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'WAITLISTED');

-- AlterTable: Add confirmationNumber to Activity
ALTER TABLE "Activity" ADD COLUMN "confirmationNumber" TEXT;

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "itineraryItemId" TEXT NOT NULL,
    "confirmationNumber" TEXT,
    "provider" TEXT,
    "bookingUrl" TEXT,
    "partySize" INTEGER,
    "specialRequests" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_itineraryItemId_key" ON "Reservation"("itineraryItemId");

-- CreateIndex
CREATE INDEX "Reservation_itineraryItemId_idx" ON "Reservation"("itineraryItemId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_itineraryItemId_fkey" FOREIGN KEY ("itineraryItemId") REFERENCES "ItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
