"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { optimizeItinerary } from "@/lib/optimizer"
import { z } from "zod"

const itemSchema = z.object({
  date: z.string(),
  startTime: z.string().optional(),
  type: z.enum(["FLIGHT","HOTEL_CHECK_IN","HOTEL_CHECK_OUT","ACTIVITY","MEAL","TRANSIT","BUFFER","CUSTOM"]),
  title: z.string().min(1),
  notes: z.string().optional(),
  activityId: z.string().optional(),
  flightId: z.string().optional(),
  hotelId: z.string().optional(),
  durationMins: z.number().int().min(5).default(60),
  costEstimate: z.number().min(0).default(0),
  position: z.number().int().default(0),
})

export async function getItinerary(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  return prisma.itineraryItem.findMany({
    where: { tripId },
    include: {
      activity: true,
      flight: true,
      hotel: true,
    },
    orderBy: [{ date: "asc" }, { position: "asc" }, { startTime: "asc" }],
  })
}

export async function createItineraryItem(tripId: string, data: z.infer<typeof itemSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const parsed = itemSchema.parse(data)
  const item = await prisma.itineraryItem.create({
    data: {
      tripId,
      ...parsed,
      date: new Date(parsed.date),
    },
  })

  revalidatePath(`/trip/${tripId}/itinerary`)
  return item
}

export async function updateItineraryItem(
  tripId: string,
  itemId: string,
  data: Partial<z.infer<typeof itemSchema>>
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.itineraryItem.update({
    where: { id: itemId },
    data: {
      ...data,
      ...(data.date && { date: new Date(data.date) }),
    },
  })

  revalidatePath(`/trip/${tripId}/itinerary`)
  return updated
}

export async function deleteItineraryItem(tripId: string, itemId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.itineraryItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/itinerary`)
}

export async function reorderItineraryItems(tripId: string, updates: { id: string; position: number; date: string }[]) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  await prisma.$transaction(
    updates.map(u =>
      prisma.itineraryItem.update({
        where: { id: u.id },
        data: { position: u.position, date: new Date(u.date) },
      })
    )
  )

  revalidatePath(`/trip/${tripId}/itinerary`)
}

export async function runOptimizer(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, userId: session.user.id },
    include: {
      activities: { where: { status: { in: ["WISHLIST", "SCHEDULED"] } } },
      hotels: { orderBy: { checkIn: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      travelers: { include: { traveler: true } },
      user: { include: { preferences: true } },
    },
  })

  const prefs = trip.user.preferences
  const primaryHotel = trip.hotels[0]

  // Build fixed items from flights and hotels
  const fixedItems = [
    ...trip.flights.map(f => ({
      id: f.id,
      type: "FLIGHT" as const,
      date: f.departureTime,
      startTime: f.departureTime.toTimeString().slice(0, 5),
      durationMins: Math.ceil((f.arrivalTime.getTime() - f.departureTime.getTime()) / 60000),
      title: `Flight ${f.flightNumber || ""}`,
      lat: null,
      lng: null,
    })),
    ...trip.hotels.flatMap(h => [
      { id: h.id + "-in", type: "HOTEL_CHECK_IN" as const, date: h.checkIn, startTime: h.checkIn.toTimeString().slice(0, 5), durationMins: 30, title: `Check in ${h.name}`, lat: h.lat, lng: h.lng },
      { id: h.id + "-out", type: "HOTEL_CHECK_OUT" as const, date: h.checkOut, startTime: h.checkOut.toTimeString().slice(0, 5), durationMins: 30, title: `Check out ${h.name}`, lat: h.lat, lng: h.lng },
    ]),
  ]

  const adultCount = trip.travelers.filter(t => !t.traveler.tags.includes("child")).length || 1
  const childCount = trip.travelers.filter(t => t.traveler.tags.includes("child")).length

  const result = optimizeItinerary(trip.activities, fixedItems, {
    startDate: trip.startDate,
    endDate: trip.endDate,
    hotelLat: primaryHotel?.lat,
    hotelLng: primaryHotel?.lng,
    dailyBudget: prefs?.avgDailyBudget,
    pacingStyle: (prefs?.pacingStyle as "CHILL" | "LEISURELY" | "MODERATE" | "ACTIVE" | "PACKED") || "MODERATE",
    wakeUpTime: prefs?.wakeUpTime || "08:00",
    bedTime: prefs?.bedTime || "22:00",
    adultCount,
    childCount,
  })

  // Delete existing non-fixed itinerary items and replace with optimized schedule
  await prisma.itineraryItem.deleteMany({
    where: { tripId, type: { notIn: ["FLIGHT", "HOTEL_CHECK_IN", "HOTEL_CHECK_OUT"] } },
  })

  if (result.scheduledItems.length > 0) {
    await prisma.itineraryItem.createMany({
      data: result.scheduledItems.map((item, i) => ({
        tripId,
        activityId: item.activityId,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        type: "ACTIVITY" as const,
        title: trip.activities.find(a => a.id === item.activityId)?.name || "Activity",
        durationMins: item.durationMins,
        travelTimeToNextMins: item.travelTimeToNextMins,
        costEstimate: item.costEstimate,
        position: i,
      })),
    })

    // Update activity statuses
    await prisma.activity.updateMany({
      where: { id: { in: result.scheduledItems.map(i => i.activityId) } },
      data: { status: "SCHEDULED" },
    })
  }

  revalidatePath(`/trip/${tripId}/itinerary`)
  return result
}
