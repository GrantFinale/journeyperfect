-- CreateTable
CREATE TABLE "PackingItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "isPacked" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackingItem_tripId_idx" ON "PackingItem"("tripId");

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
