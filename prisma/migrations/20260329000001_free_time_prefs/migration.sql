-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN "showFreeTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserPreferences" ADD COLUMN "freeTimeMinGapHours" INTEGER NOT NULL DEFAULT 2;
