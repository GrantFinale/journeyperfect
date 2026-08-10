"use server"

import { cache } from "react"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { computeTripTasks, type TaskSubject, type TripTask } from "@/lib/trip-tasks"

/**
 * A `@db.Date` column comes back from Prisma as UTC midnight, so slicing the ISO
 * string is the correct way to get the stored calendar day back out.
 */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/**
 * One query for every task surface on the trip.
 *
 * Memoised per request with React `cache`, so the To Do page (which needs the
 * full list) and the nav badge (which needs only a count) share a single round
 * trip — including the `requireTripAccess` check — when both run in the same
 * render.
 *
 * NOTE: `EventAttachment.data` is a `bytea` column that Prisma would select by
 * default. We only need to know *whether* an item has attachments, so this uses
 * `_count`; never widen this to include the attachment rows themselves or every
 * page render would stream every uploaded voucher out of the database.
 *
 * There is deliberately no `WHERE` clause narrowing rows to "items that could
 * raise a task" — that would duplicate the rules from `@/lib/trip-tasks` in SQL,
 * where they could silently drift out of sync. The select is narrow and the
 * lookup rides the `[tripId, date]` index, so the whole itinerary is cheap.
 */
const loadTaskSubjects = cache(async (tripId: string): Promise<TaskSubject[]> => {
  await requireTripAccess(tripId)

  const items = await prisma.itineraryItem.findMany({
    where: { tripId },
    select: {
      id: true,
      title: true,
      type: true,
      date: true,
      startTime: true,
      needsReservation: true,
      reservation: {
        select: {
          confirmationNumber: true,
          reservationName: true,
          bookingUrl: true,
          status: true,
          price: true,
          balanceDue: true,
          balanceDueDate: true,
          checkInOpensAt: true,
          checkInCompletedAt: true,
        },
      },
      // Departure times for the derived check-in window on travel legs.
      flight: { select: { departureTime: true } },
      transportSegment: { select: { departureTime: true } },
      // Presence only — see the note above about the `data` blob.
      _count: { select: { attachments: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  return items.map((item) => ({
    itineraryItemId: item.id,
    title: item.title,
    type: item.type,
    date: toDateKey(item.date),
    startTime: item.startTime,
    needsReservation: item.needsReservation,
    hasAttachments: item._count.attachments > 0,
    reservation: item.reservation
      ? {
          confirmationNumber: item.reservation.confirmationNumber,
          reservationName: item.reservation.reservationName,
          bookingUrl: item.reservation.bookingUrl,
          status: item.reservation.status,
          price: item.reservation.price,
          balanceDue: item.reservation.balanceDue,
          balanceDueDate: toIso(item.reservation.balanceDueDate),
          checkInOpensAt: toIso(item.reservation.checkInOpensAt),
          checkInCompletedAt: toIso(item.reservation.checkInCompletedAt),
        }
      : null,
    departureTime: toIso(item.flight?.departureTime ?? item.transportSegment?.departureTime),
  }))
})

/** Everything still outstanding on this trip, most urgent first. */
export async function getTripTasks(tripId: string): Promise<TripTask[]> {
  const subjects = await loadTaskSubjects(tripId)
  return computeTripTasks(subjects, new Date())
}

/**
 * Just the number, for the nav badge. Runs on every trip page render, so it
 * reuses the memoised subject query rather than issuing anything extra.
 */
export async function getTripTaskCount(tripId: string): Promise<number> {
  const tasks = await getTripTasks(tripId)
  return tasks.length
}
