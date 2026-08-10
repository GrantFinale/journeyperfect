-- AlterTable: user-flagged "still needs booking". Set by hand on an event that
-- has no reservation yet; cleared once a confirmation number or an attachment
-- arrives. Defaults false so every existing row reads as "nothing outstanding".
ALTER TABLE "ItineraryItem" ADD COLUMN "needsReservation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: payment balance and check-in window on a reservation.
-- `balanceDue` is what is *still owed* and is deliberately distinct from
-- `price` (already paid) — a deposit-then-balance booking carries both.
-- `checkInOpensAt` is the explicit window; travel legs without one derive it
-- from departure instead. `checkInCompletedAt` clears the To Do task.
ALTER TABLE "Reservation" ADD COLUMN "balanceDue" DOUBLE PRECISION,
ADD COLUMN "balanceDueDate" TIMESTAMP(3),
ADD COLUMN "checkInCompletedAt" TIMESTAMP(3),
ADD COLUMN "checkInOpensAt" TIMESTAMP(3);
