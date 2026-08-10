-- AlterTable: the name a booking is held under, distinct from `provider`
-- ("OpenTable" is who you booked through; "Grant Benedict" is who the table
-- is under at the host stand).
ALTER TABLE "Reservation" ADD COLUMN "reservationName" TEXT;
