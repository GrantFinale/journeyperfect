"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { parseHotelTextWithAI } from "@/lib/hotel-parser-ai"
import { z } from "zod"
import { hasFeature } from "@/lib/features"

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
  price: z.number().optional(),
  priceCurrency: z.string().optional(),
  roomCount: z.number().default(1),
  roomType: z.string().optional(),
})

export async function createHotel(tripId: string, data: z.infer<typeof hotelSchema>) {
  await requireTripAccess(tripId, "EDITOR")

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

  // Auto-create BudgetItem for hotel cost
  if (parsed.price) {
    const checkInDate = new Date(parsed.checkIn)
    const checkOutDate = new Date(parsed.checkOut)
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / 86400000)
    const roomCount = parsed.roomCount || 1
    const totalCost = parsed.price * nights * roomCount
    await prisma.budgetItem.create({
      data: {
        tripId,
        category: "LODGING",
        title: `${parsed.name} (${nights} night${nights > 1 ? "s" : ""}${roomCount > 1 ? `, ${roomCount} rooms` : ""})`,
        amount: totalCost,
        isEstimate: false,
      },
    })
  }

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return hotel
}

export async function parseAndPreviewHotel(text: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })

  // AI parsing is a paid feature (reuse aiFlightParsing gate for now)
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED:AI hotel parsing requires a paid plan. Please enter hotel details manually or upgrade your plan.")
  }

  try {
    const aiResult = await parseHotelTextWithAI(text)
    if (aiResult && aiResult.hotels.length > 0) {
      return aiResult
    }
  } catch (err) {
    console.error("[parseAndPreviewHotel] AI parser threw:", err)
  }

  throw new Error("PARSE_FAILED:Could not parse hotel details. Please enter them manually.")
}

export async function createHotelsBatch(tripId: string, hotels: z.infer<typeof hotelSchema>[]) {
  await requireTripAccess(tripId, "EDITOR")

  const created = await prisma.$transaction(
    hotels.map((hotel) => {
      const parsed = hotelSchema.parse(hotel)
      const checkInDate = new Date(parsed.checkIn)
      const checkOutDate = new Date(parsed.checkOut)
      return prisma.hotel.create({
        data: {
          tripId,
          ...parsed,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          itineraryItems: {
            createMany: {
              data: [
                {
                  tripId,
                  date: checkInDate,
                  startTime: checkInDate.toTimeString().slice(0, 5),
                  type: "HOTEL_CHECK_IN" as const,
                  title: `Check in: ${parsed.name}`,
                  durationMins: 30,
                  position: 0,
                  isConfirmed: true,
                },
                {
                  tripId,
                  date: checkOutDate,
                  startTime: checkOutDate.toTimeString().slice(0, 5),
                  type: "HOTEL_CHECK_OUT" as const,
                  title: `Check out: ${parsed.name}`,
                  durationMins: 30,
                  position: 0,
                  isConfirmed: true,
                },
              ],
            },
          },
        },
      })
    })
  )

  // Create BudgetItems for hotels with prices
  for (let i = 0; i < hotels.length; i++) {
    const parsed = hotelSchema.parse(hotels[i])
    if (parsed.price) {
      const checkInDate = new Date(parsed.checkIn)
      const checkOutDate = new Date(parsed.checkOut)
      const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / 86400000)
      const roomCount = parsed.roomCount || 1
      const totalCost = parsed.price * nights * roomCount
      await prisma.budgetItem.create({
        data: {
          tripId,
          category: "LODGING",
          title: `${parsed.name} (${nights} night${nights > 1 ? "s" : ""}${roomCount > 1 ? `, ${roomCount} rooms` : ""})`,
          amount: totalCost,
          isEstimate: false,
        },
      })
    }
  }

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return created
}

export async function updateHotel(tripId: string, hotelId: string, data: Partial<z.infer<typeof hotelSchema>>) {
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")
  await prisma.hotel.delete({ where: { id: hotelId } })
  revalidatePath(`/trip/${tripId}`)
}
