-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('VOUCHER', 'RECEIPT', 'TICKET', 'CONFIRMATION', 'OTHER');

-- CreateTable
CREATE TABLE "EventAttachment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "itineraryItemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventAttachment_itineraryItemId_idx" ON "EventAttachment"("itineraryItemId");

-- CreateIndex
CREATE INDEX "EventAttachment_tripId_idx" ON "EventAttachment"("tripId");

-- AddForeignKey
ALTER TABLE "EventAttachment" ADD CONSTRAINT "EventAttachment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttachment" ADD CONSTRAINT "EventAttachment_itineraryItemId_fkey" FOREIGN KEY ("itineraryItemId") REFERENCES "ItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttachment" ADD CONSTRAINT "EventAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

