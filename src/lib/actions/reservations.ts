"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "WAITLISTED"] as const

/**
 * Dates arrive either as real `Date`s (server callers) or as strings from
 * `<input type="date">` / `<input type="datetime-local">`. `null` is meaningful:
 * it clears the field. `undefined` means "not supplied — leave it alone".
 */
const dateLike = z.union([z.date(), z.string(), z.null()]).optional()

/**
 * Every writable column except `currency`/`status`, which need different
 * treatment on create (defaults) and update (no defaults — see below).
 */
const reservationFields = {
  confirmationNumber: z.string().optional(),
  provider: z.string().optional(),
  reservationName: z.string().optional(),
  bookingUrl: z.string().optional(),
  partySize: z.number().int().optional(),
  specialRequests: z.string().optional(),
  price: z.number().optional(),
  notes: z.string().optional(),
  /** Still owed, distinct from `price` (which is what the booking costs). */
  balanceDue: z.number().nullable().optional(),
  balanceDueDate: dateLike,
  /** Explicit check-in window; travel legs otherwise derive it from departure. */
  checkInOpensAt: dateLike,
  /** Stamped when the traveller has checked in — this is what clears the task. */
  checkInCompletedAt: dateLike,
}

const reservationSchema = z.object({
  ...reservationFields,
  currency: z.string().default("USD"),
  status: z.enum(RESERVATION_STATUSES).default("CONFIRMED"),
})

/**
 * The update schema is deliberately default-free. `updateReservation` MERGES:
 * a key you don't send is left untouched in the database. Applying the create
 * defaults here would mean every partial save silently reset `currency` to USD
 * and `status` to CONFIRMED.
 *
 * Merge semantics also protect the newer payment/check-in columns from the
 * Overview editor (`src/components/reservations-manager.tsx`), which still
 * sends its original ten-field payload and knows nothing about them.
 */
const reservationUpdateSchema = z.object({
  ...reservationFields,
  currency: z.string().optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
})

export type ReservationInput = z.infer<typeof reservationSchema>

type DateLike = Date | string | null | undefined

function normalizeDate(value: DateLike): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Turns the three `dateLike` fields into `Date | null | undefined` for Prisma. */
function withNormalizedDates<
  T extends {
    balanceDueDate?: DateLike
    checkInOpensAt?: DateLike
    checkInCompletedAt?: DateLike
  },
>(data: T) {
  return {
    ...data,
    balanceDueDate: normalizeDate(data.balanceDueDate),
    checkInOpensAt: normalizeDate(data.checkInOpensAt),
    checkInCompletedAt: normalizeDate(data.checkInCompletedAt),
  }
}

/**
 * Reservation ids are not scoped to a trip, so every mutation has to prove the
 * record actually hangs off an itinerary item in *this* trip — trip access
 * alone would otherwise let an editor of one trip write to another's booking.
 */
async function requireReservationInTrip(tripId: string, reservationId: string) {
  return prisma.reservation.findFirstOrThrow({
    where: { id: reservationId, itineraryItem: { tripId } },
    select: { id: true },
  })
}

/**
 * The flag, the confirmation number, the balance and the check-in stamp all feed
 * the To Do screen and its nav badge as well as the plan, so invalidate the
 * whole trip subtree rather than the itinerary route alone.
 */
function revalidateTrip(tripId: string) {
  revalidatePath(`/trip/${tripId}/itinerary`)
  revalidatePath(`/trip/${tripId}`, "layout")
}

export async function createReservation(
  tripId: string,
  itineraryItemId: string,
  data: ReservationInput
) {
  await requireTripAccess(tripId, "EDITOR")
  const parsed = withNormalizedDates(reservationSchema.parse(data))

  // Verify the itinerary item belongs to this trip
  await prisma.itineraryItem.findFirstOrThrow({
    where: { id: itineraryItemId, tripId },
  })

  const reservation = await prisma.reservation.create({
    data: { itineraryItemId, ...parsed },
  })

  revalidateTrip(tripId)
  return reservation
}

export async function updateReservation(
  tripId: string,
  reservationId: string,
  data: Partial<ReservationInput>
) {
  await requireTripAccess(tripId, "EDITOR")
  await requireReservationInTrip(tripId, reservationId)

  // Prisma treats an `undefined` key as "don't touch this column", which is what
  // makes this a merge rather than an overwrite.
  const patch = withNormalizedDates(reservationUpdateSchema.parse(data))

  const reservation = await prisma.reservation.update({
    where: { id: reservationId },
    data: patch,
  })
  revalidateTrip(tripId)
  return reservation
}

/**
 * Marks the booking as checked in (or un-checks it). Split out from
 * `updateReservation` so the modal can offer a one-tap "I've checked in" —
 * that stamp is the only thing that clears the CHECK_IN task.
 */
export async function setCheckInCompleted(
  tripId: string,
  reservationId: string,
  completed: boolean
) {
  await requireTripAccess(tripId, "EDITOR")
  await requireReservationInTrip(tripId, reservationId)

  const reservation = await prisma.reservation.update({
    where: { id: reservationId },
    data: { checkInCompletedAt: completed ? new Date() : null },
  })
  revalidateTrip(tripId)
  return reservation
}

export async function deleteReservation(
  tripId: string,
  reservationId: string
) {
  await requireTripAccess(tripId, "EDITOR")
  await requireReservationInTrip(tripId, reservationId)
  await prisma.reservation.delete({ where: { id: reservationId } })
  revalidateTrip(tripId)
}
