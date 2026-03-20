-- AlterEnum
ALTER TYPE "ItineraryItemType" ADD VALUE 'RENTAL_CAR_PICKUP';
ALTER TYPE "ItineraryItemType" ADD VALUE 'RENTAL_CAR_DROPOFF';

-- CreateTable
CREATE TABLE "RentalCar" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "company" TEXT,
    "confirmationNumber" TEXT,
    "vehicleType" TEXT,
    "pickupLocation" TEXT,
    "pickupAddress" TEXT,
    "pickupTime" TIMESTAMP(3) NOT NULL,
    "pickupTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "dropoffLocation" TEXT,
    "dropoffAddress" TEXT,
    "dropoffTime" TIMESTAMP(3) NOT NULL,
    "dropoffTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "price" DOUBLE PRECISION,
    "priceCurrency" TEXT DEFAULT 'USD',
    "bookingLink" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalCar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalCar_tripId_idx" ON "RentalCar"("tripId");

-- AlterTable
ALTER TABLE "ItineraryItem" ADD COLUMN "rentalCarId" TEXT;

-- AddForeignKey
ALTER TABLE "RentalCar" ADD CONSTRAINT "RentalCar_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_rentalCarId_fkey" FOREIGN KEY ("rentalCarId") REFERENCES "RentalCar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
