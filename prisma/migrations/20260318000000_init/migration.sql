-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PERSONAL', 'FAMILY', 'PRO');
CREATE TYPE "TripStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "PacingStyle" AS ENUM ('CHILL', 'LEISURELY', 'MODERATE', 'ACTIVE', 'PACKED');
CREATE TYPE "ActivityPriority" AS ENUM ('MUST_DO', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ActivityStatus" AS ENUM ('WISHLIST', 'SCHEDULED', 'DONE', 'SKIPPED');
CREATE TYPE "IndoorOutdoor" AS ENUM ('INDOOR', 'OUTDOOR', 'BOTH');
CREATE TYPE "ItineraryItemType" AS ENUM ('FLIGHT', 'HOTEL_CHECK_IN', 'HOTEL_CHECK_OUT', 'ACTIVITY', 'MEAL', 'TRANSIT', 'BUFFER', 'CUSTOM');
CREATE TYPE "DocumentType" AS ENUM ('BOARDING_PASS', 'HOTEL_CONFIRMATION', 'VISA', 'PASSPORT', 'INSURANCE', 'RENTAL_CAR', 'OTHER');
CREATE TYPE "BudgetCategory" AS ENUM ('FLIGHTS', 'LODGING', 'ACTIVITIES', 'DINING', 'TRANSPORT', 'SHOPPING', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "stripeCustomerId" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "planStatus" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "TravelerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "tags" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "airportArrivalBufferMins" INTEGER NOT NULL DEFAULT 90,
    "pacingStyle" "PacingStyle" NOT NULL DEFAULT 'MODERATE',
    "avgDailyBudget" DOUBLE PRECISION,
    "wakeUpTime" TEXT NOT NULL DEFAULT '08:00',
    "bedTime" TEXT NOT NULL DEFAULT '22:00',
    "mealStylePrefs" TEXT[],
    "activityMix" TEXT[],
    "mobilityNotes" TEXT,
    "maxDailyTravelMins" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "destinationLat" DOUBLE PRECISION,
    "destinationLng" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "shareSlug" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "coverImage" TEXT,
    "notes" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripTraveler" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "travelerProfileId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TripTraveler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotel" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "confirmationNumber" TEXT,
    "bookingLink" TEXT,
    "notes" TEXT,
    "isVacationRental" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "airline" TEXT,
    "flightNumber" TEXT,
    "departureAirport" TEXT,
    "departureCity" TEXT,
    "departureTime" TIMESTAMP(3) NOT NULL,
    "departureTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "arrivalAirport" TEXT,
    "arrivalCity" TEXT,
    "arrivalTime" TIMESTAMP(3) NOT NULL,
    "arrivalTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "confirmationNumber" TEXT,
    "bookingLink" TEXT,
    "cabin" TEXT,
    "notes" TEXT,
    "passengers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "googlePlaceId" TEXT,
    "category" TEXT,
    "durationMins" INTEGER NOT NULL DEFAULT 120,
    "costPerAdult" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPerChild" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" "ActivityPriority" NOT NULL DEFAULT 'MEDIUM',
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "fixedDateTime" TIMESTAMP(3),
    "indoorOutdoor" "IndoorOutdoor" NOT NULL DEFAULT 'BOTH',
    "reservationNeeded" BOOLEAN NOT NULL DEFAULT false,
    "bookingLink" TEXT,
    "websiteUrl" TEXT,
    "imageUrl" TEXT,
    "rating" DOUBLE PRECISION,
    "hoursJson" TEXT,
    "bestTimeOfDay" TEXT,
    "notes" TEXT,
    "status" "ActivityStatus" NOT NULL DEFAULT 'WISHLIST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "type" "ItineraryItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "activityId" TEXT,
    "flightId" TEXT,
    "hotelId" TEXT,
    "durationMins" INTEGER NOT NULL DEFAULT 60,
    "travelTimeToNextMins" INTEGER NOT NULL DEFAULT 0,
    "costEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelDocument" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "flightId" TEXT,
    "hotelId" TEXT,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT,
    "externalLink" TEXT,
    "confirmationCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

CREATE INDEX "TravelerProfile_userId_idx" ON "TravelerProfile"("userId");

CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

CREATE UNIQUE INDEX "Trip_shareSlug_key" ON "Trip"("shareSlug");
CREATE INDEX "Trip_userId_idx" ON "Trip"("userId");
CREATE INDEX "Trip_shareSlug_idx" ON "Trip"("shareSlug");

CREATE UNIQUE INDEX "TripTraveler_tripId_travelerProfileId_key" ON "TripTraveler"("tripId", "travelerProfileId");

CREATE INDEX "Hotel_tripId_idx" ON "Hotel"("tripId");

CREATE INDEX "Flight_tripId_idx" ON "Flight"("tripId");

CREATE INDEX "Activity_tripId_idx" ON "Activity"("tripId");
CREATE INDEX "Activity_tripId_status_idx" ON "Activity"("tripId", "status");

CREATE INDEX "ItineraryItem_tripId_date_idx" ON "ItineraryItem"("tripId", "date");

CREATE INDEX "TravelDocument_tripId_idx" ON "TravelDocument"("tripId");

CREATE INDEX "BudgetItem_tripId_idx" ON "BudgetItem"("tripId");

CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelerProfile" ADD CONSTRAINT "TravelerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTraveler" ADD CONSTRAINT "TripTraveler_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTraveler" ADD CONSTRAINT "TripTraveler_travelerProfileId_fkey" FOREIGN KEY ("travelerProfileId") REFERENCES "TravelerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TravelDocument" ADD CONSTRAINT "TravelDocument_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelDocument" ADD CONSTRAINT "TravelDocument_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TravelDocument" ADD CONSTRAINT "TravelDocument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
