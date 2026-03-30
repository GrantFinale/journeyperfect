"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const reservationSchema = z.object({
  confirmationNumber: z.string().optional(),
  provider: z.string().optional(),
  bookingUrl: z.string().optional(),
  partySize: z.number().int().optional(),
  specialRequests: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().default("USD"),
  status: z
    .enum(["PENDING", "CONFIRMED", "CANCELLED", "WAITLISTED"])
    .default("CONFIRMED"),
  notes: z.string().optional(),
})

export type ReservationInput = z.infer<typeof reservationSchema>

export async function createReservation(
  tripId: string,
  itineraryItemId: string,
  data: ReservationInput
) {
  await requireTripAccess(tripId, "EDITOR")
  const parsed = reservationSchema.parse(data)

  // Verify the itinerary item belongs to this trip
  await prisma.itineraryItem.findFirstOrThrow({
    where: { id: itineraryItemId, tripId },
  })

  const reservation = await prisma.reservation.create({
    data: { itineraryItemId, ...parsed },
  })

  revalidatePath(`/trip/${tripId}/itinerary`)
  return reservation
}

export async function updateReservation(
  tripId: string,
  reservationId: string,
  data: Partial<ReservationInput>
) {
  await requireTripAccess(tripId, "EDITOR")
  const reservation = await prisma.reservation.update({
    where: { id: reservationId },
    data,
  })
  revalidatePath(`/trip/${tripId}/itinerary`)
  return reservation
}

export async function deleteReservation(
  tripId: string,
  reservationId: string
) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.reservation.delete({ where: { id: reservationId } })
  revalidatePath(`/trip/${tripId}/itinerary`)
}
