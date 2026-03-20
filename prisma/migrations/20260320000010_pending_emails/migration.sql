-- CreateTable
CREATE TABLE "PendingEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parsedData" JSONB,
    "type" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingEmail_userId_idx" ON "PendingEmail"("userId");

-- CreateIndex
CREATE INDEX "PendingEmail_userId_processed_idx" ON "PendingEmail"("userId", "processed");

-- AddForeignKey
ALTER TABLE "PendingEmail" ADD CONSTRAINT "PendingEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
