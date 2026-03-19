"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const hotelSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  checkIn: z.string(),
  checkOut: z.string(),
  confirmationNumber: z.string().optional(),
  bookingLink: z.string().optional(),
  notes: z.string().optional(),
  isVacationRental: z.boolean().default(false),
})

export async function createHotel(tripId: string, data: z.infer<typeof hotelSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const parsed = hotelSchema.parse(data)
  const hotel = await prisma.hotel.create({
    data: {
      tripId,
      ...parsed,
      checkIn: new Date(parsed.checkIn),
      checkOut: new Date(parsed.checkOut),
    },
  })

  // Auto-create check-in and check-out itinerary items
  await prisma.itineraryItem.createMany({
    data: [
      {
        tripId,
        hotelId: hotel.id,
        date: new Date(parsed.checkIn),
        startTime: new Date(parsed.checkIn).toTimeString().slice(0, 5),
        type: "HOTEL_CHECK_IN",
        title: `🏨 Check in: ${parsed.name}`,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
      {
        tripId,
        hotelId: hotel.id,
        date: new Date(parsed.checkOut),
        startTime: new Date(parsed.checkOut).toTimeString().slice(0, 5),
        type: "HOTEL_CHECK_OUT",
        title: `🏨 Check out: ${parsed.name}`,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
    ],
  })

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return hotel
}

export async function updateHotel(tripId: string, hotelId: string, data: Partial<z.infer<typeof hotelSchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.hotel.update({
    where: { id: hotelId },
    data: {
      ...data,
      ...(data.checkIn && { checkIn: new Date(data.checkIn) }),
      ...(data.checkOut && { checkOut: new Date(data.checkOut) }),
    },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function deleteHotel(tripId: string, hotelId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.hotel.delete({ where: { id: hotelId } })
  revalidatePath(`/trip/${tripId}`)
}
