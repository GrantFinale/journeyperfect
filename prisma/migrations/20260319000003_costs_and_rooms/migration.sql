-- Add price fields to Flight
ALTER TABLE "Flight" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "Flight" ADD COLUMN "priceCurrency" TEXT DEFAULT 'USD';

-- Add price and room fields to Hotel
ALTER TABLE "Hotel" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "Hotel" ADD COLUMN "priceCurrency" TEXT DEFAULT 'USD';
ALTER TABLE "Hotel" ADD COLUMN "roomCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Hotel" ADD COLUMN "roomType" TEXT;
