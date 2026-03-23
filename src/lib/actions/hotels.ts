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

export async function getCheckInTimeForDate(tripId: string, checkInDate: Date): Promise<string> {
  // Look for flights arriving on the same day as hotel check-in
  const dayStart = new Date(checkInDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(checkInDate)
  dayEnd.setHours(23, 59, 59, 999)

  const arrivingFlights = await prisma.flight.findMany({
    where: {
      tripId,
      arrivalTime: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { arrivalTime: "desc" },
    select: { arrivalTime: true },
  })

  if (arrivingFlights.length > 0) {
    // Set check-in to 1 hour after the latest flight arrival
    const latestArrival = arrivingFlights[0].arrivalTime
    const checkInTime = new Date(latestArrival.getTime() + 60 * 60 * 1000)
    return checkInTime.toTimeString().slice(0, 5)
  }

  // Default: 3:00 PM standard check-in time
  return "15:00"
}

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

  // Geocode the hotel address if we don't have coordinates
  if (!parsed.lat && !parsed.lng && (parsed.address || parsed.name)) {
    try {
      const gKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || ""
      if (gKey && gKey !== "build-placeholder") {
        const query = encodeURIComponent(parsed.address || parsed.name)
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${gKey}`)
        const data = await res.json()
        if (data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location
          await prisma.hotel.update({ where: { id: hotel.id }, data: { lat, lng } })
          hotel.lat = lat
          hotel.lng = lng
        }
      }
    } catch {
      // Geocoding is best-effort — don't fail hotel creation
    }
  }

  // Determine check-in time based on arriving flights
  const checkInDate = new Date(parsed.checkIn)
  const checkInTime = await getCheckInTimeForDate(tripId, checkInDate)

  // Auto-create check-in and check-out itinerary items
  await prisma.itineraryItem.createMany({
    data: [
      {
        tripId,
        hotelId: hotel.id,
        date: checkInDate,
        startTime: checkInTime,
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
        startTime: "11:00",
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
    const aiResult = await parseHotelTextWithAI(text, session.user.id)
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

  // Pre-compute check-in times for each hotel (needs async flight lookups)
  const parsedHotels = hotels.map((h) => hotelSchema.parse(h))
  const checkInTimes = await Promise.all(
    parsedHotels.map((parsed) => getCheckInTimeForDate(tripId, new Date(parsed.checkIn)))
  )

  const created = await prisma.$transaction(
    parsedHotels.map((parsed, i) => {
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
                  startTime: checkInTimes[i],
                  type: "HOTEL_CHECK_IN" as const,
                  title: `Check in: ${parsed.name}`,
                  durationMins: 30,
                  position: 0,
                  isConfirmed: true,
                },
                {
                  tripId,
                  date: checkOutDate,
                  startTime: "11:00",
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
    where: { id: hotelId, tripId },
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
  await prisma.hotel.delete({ where: { id: hotelId, tripId } })
  revalidatePath(`/trip/${tripId}`)
}
