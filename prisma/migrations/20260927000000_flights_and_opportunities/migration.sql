-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "builtFromOpportunityId" TEXT,
ADD COLUMN     "opportunityRationale" JSONB;

-- CreateTable
CREATE TABLE "FlightSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departDate" DATE NOT NULL,
    "returnDate" DATE,
    "cabin" TEXT NOT NULL DEFAULT 'economy',
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "maxStops" INTEGER,
    "isTracking" BOOLEAN NOT NULL DEFAULT false,
    "targetPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lastCheckedAt" TIMESTAMP(3),
    "lastPrice" DOUBLE PRECISION,
    "lowestPrice" DOUBLE PRECISION,
    "queryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightOffer" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "carrierCodes" TEXT[],
    "stops" INTEGER NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "outbound" JSONB NOT NULL,
    "inbound" JSONB,
    "bookingUrl" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FlightOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightPricePoint" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "insight" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightPricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originAirports" TEXT[],
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "nightsMin" INTEGER NOT NULL,
    "nightsMax" INTEGER NOT NULL,
    "weekdayPattern" TEXT,
    "travelerProfileIds" TEXT[],
    "constraints" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "privateRatesAuthorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OpportunitySearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCandidate" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "destinationIata" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "pruned" BOOLEAN NOT NULL DEFAULT false,
    "prunedReason" TEXT,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "flightSearchId" TEXT,
    "score" DOUBLE PRECISION,
    "headlineFactor" TEXT,

    CONSTRAINT "OpportunityCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelOpportunity" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationIata" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "travelerCount" INTEGER NOT NULL,
    "nonstopAvailable" BOOLEAN NOT NULL,
    "flightOfferId" TEXT,
    "transportation" JSONB NOT NULL,
    "airfareTotal" DOUBLE PRECISION,
    "airfareSource" TEXT NOT NULL,
    "hotelRateQuoteId" TEXT,
    "publicRateQuoteId" TEXT,
    "hotelName" TEXT,
    "privateNightlyRate" DOUBLE PRECISION,
    "comparablePublicRate" DOUBLE PRECISION,
    "hotelSavingsTotal" DOUBLE PRECISION,
    "groundTransportEstimate" DOUBLE PRECISION,
    "majorActivityEstimate" DOUBLE PRECISION,
    "coreTripCost" DOUBLE PRECISION,
    "coreTripCostSource" TEXT NOT NULL,
    "weatherContext" JSONB NOT NULL,
    "anchorExperience" JSONB,
    "familyFitReasons" TEXT[],
    "opportunityReasons" JSONB NOT NULL,
    "headlineFactor" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "builtTripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotelRateQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "propertyCode" TEXT NOT NULL,
    "propertyName" TEXT NOT NULL,
    "brand" TEXT,
    "tier" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "rateKind" TEXT NOT NULL,
    "nightlyRate" DOUBLE PRECISION NOT NULL,
    "totalRate" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "roomType" TEXT,
    "available" BOOLEAN NOT NULL,
    "sessionId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelRateQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DestinationProfile" (
    "id" TEXT NOT NULL,
    "iata" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "idealNightsMin" INTEGER NOT NULL,
    "idealNightsMax" INTEGER NOT NULL,
    "walkable" BOOLEAN NOT NULL,
    "carNeeded" BOOLEAN NOT NULL,
    "airportToCenterKm" DOUBLE PRECISION NOT NULL,
    "parkingTypical" TEXT NOT NULL,
    "activitiesDispersed" BOOLEAN NOT NULL,
    "familyFit" JSONB NOT NULL,
    "anchors" JSONB NOT NULL,
    "climate" JSONB,
    "generatedBy" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DestinationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonstopRoute" (
    "id" TEXT NOT NULL,
    "originIata" TEXT NOT NULL,
    "destIata" TEXT NOT NULL,
    "carriers" TEXT[],
    "weeklyFrequency" INTEGER,
    "typicalDurationMins" INTEGER NOT NULL,
    "departureBuckets" TEXT[],
    "source" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonstopRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateRateSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "challengeKind" TEXT,
    "sealedBlobRef" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastValidatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateRateSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateRateEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "PrivateRateEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateRateAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "searchId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateRateAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlightSearch_userId_idx" ON "FlightSearch"("userId");

-- CreateIndex
CREATE INDEX "FlightSearch_tripId_idx" ON "FlightSearch"("tripId");

-- CreateIndex
CREATE INDEX "FlightSearch_queryHash_idx" ON "FlightSearch"("queryHash");

-- CreateIndex
CREATE INDEX "FlightSearch_isTracking_lastCheckedAt_idx" ON "FlightSearch"("isTracking", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "FlightOffer_searchId_idx" ON "FlightOffer"("searchId");

-- CreateIndex
CREATE INDEX "FlightOffer_searchId_totalPrice_idx" ON "FlightOffer"("searchId", "totalPrice");

-- CreateIndex
CREATE INDEX "FlightPricePoint_searchId_capturedAt_idx" ON "FlightPricePoint"("searchId", "capturedAt");

-- CreateIndex
CREATE INDEX "OpportunitySearch_userId_createdAt_idx" ON "OpportunitySearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OpportunityCandidate_searchId_stage_idx" ON "OpportunityCandidate"("searchId", "stage");

-- CreateIndex
CREATE INDEX "TravelOpportunity_userId_createdAt_idx" ON "TravelOpportunity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TravelOpportunity_searchId_idx" ON "TravelOpportunity"("searchId");

-- CreateIndex
CREATE INDEX "HotelRateQuote_userId_propertyCode_checkIn_idx" ON "HotelRateQuote"("userId", "propertyCode", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "DestinationProfile_iata_key" ON "DestinationProfile"("iata");

-- CreateIndex
CREATE INDEX "NonstopRoute_originIata_idx" ON "NonstopRoute"("originIata");

-- CreateIndex
CREATE UNIQUE INDEX "NonstopRoute_originIata_destIata_key" ON "NonstopRoute"("originIata", "destIata");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateRateSession_userId_provider_key" ON "PrivateRateSession"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateRateEntitlement_userId_provider_key" ON "PrivateRateEntitlement"("userId", "provider");

-- CreateIndex
CREATE INDEX "PrivateRateAuditLog_userId_createdAt_idx" ON "PrivateRateAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- AddForeignKey
ALTER TABLE "FlightSearch" ADD CONSTRAINT "FlightSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSearch" ADD CONSTRAINT "FlightSearch_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightOffer" ADD CONSTRAINT "FlightOffer_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "FlightSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightPricePoint" ADD CONSTRAINT "FlightPricePoint_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "FlightSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySearch" ADD CONSTRAINT "OpportunitySearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "OpportunitySearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelOpportunity" ADD CONSTRAINT "TravelOpportunity_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "OpportunitySearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateRateSession" ADD CONSTRAINT "PrivateRateSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateRateEntitlement" ADD CONSTRAINT "PrivateRateEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

