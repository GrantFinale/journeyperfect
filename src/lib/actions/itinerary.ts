"use server"

import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { optimizeItinerary } from "@/lib/optimizer"
import { optimizeItineraryWithAI } from "@/lib/optimizer-ai"
import { hasFeature } from "@/lib/features"
import { getWeatherForecast } from "@/lib/weather"
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
  await requireTripAccess(tripId)

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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")
  await prisma.itineraryItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/itinerary`)
}

export async function reorderItineraryItems(tripId: string, updates: { id: string; position: number; date: string }[]) {
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId },
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
      title: `${f.airline || ""} ${f.flightNumber || "Flight"}${f.departureAirport || f.arrivalAirport ? ` · ${[f.departureAirport, f.arrivalAirport].filter(Boolean).join(" → ")}` : ""}`.trim(),
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

export async function runAIOptimizer(tripId: string) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")

  // Check paid plan
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED")
  }

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId },
    include: {
      activities: { where: { status: { in: ["WISHLIST", "SCHEDULED"] } } },
      hotels: { orderBy: { checkIn: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      travelers: { include: { traveler: true } },
      destinations: { orderBy: { position: "asc" } },
      user: { include: { preferences: true } },
    },
  })

  // Fetch weather forecast if we have coordinates
  let weatherForecast:
    | { date: string; weatherLabel: string; tempMax: number; precipitationProbability: number }[]
    | undefined

  const lat = trip.destinationLat ?? trip.destinations.find((d) => d.lat)?.lat
  const lng = trip.destinationLng ?? trip.destinations.find((d) => d.lng)?.lng

  if (lat != null && lng != null) {
    try {
      const forecasts = await getWeatherForecast(lat, lng)
      weatherForecast = forecasts.map((f) => ({
        date: f.date,
        weatherLabel: f.condition,
        tempMax: f.highTemp,
        precipitationProbability: f.precipitationPct,
      }))
    } catch {
      // Weather is optional — continue without it
    }
  }

  const aiResult = await optimizeItineraryWithAI({
    destination: trip.destination,
    startDate: trip.startDate.toISOString().split("T")[0],
    endDate: trip.endDate.toISOString().split("T")[0],
    activities: trip.activities.map((a) => ({
      id: a.id,
      name: a.name,
      durationMins: a.durationMins,
      lat: a.lat,
      lng: a.lng,
      priority: a.priority,
      indoorOutdoor: a.indoorOutdoor,
      isFixed: a.isFixed,
      fixedDateTime: a.fixedDateTime?.toISOString() ?? null,
      category: a.category,
    })),
    flights: trip.flights.map((f) => ({
      departureTime: f.departureTime.toISOString(),
      arrivalTime: f.arrivalTime.toISOString(),
      departureAirport: f.departureAirport,
      arrivalAirport: f.arrivalAirport,
    })),
    hotels: trip.hotels.map((h) => ({
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      checkIn: h.checkIn.toISOString(),
      checkOut: h.checkOut.toISOString(),
    })),
    travelers: trip.travelers.map((t) => ({
      name: t.traveler.name,
      tags: t.traveler.tags as string[],
    })),
    weatherForecast,
  })

  // If AI fails, fall back to rule-based optimizer
  if (!aiResult) {
    return runOptimizer(tripId)
  }

  // Delete existing non-fixed itinerary items and replace with AI schedule
  await prisma.itineraryItem.deleteMany({
    where: { tripId, type: { notIn: ["FLIGHT", "HOTEL_CHECK_IN", "HOTEL_CHECK_OUT"] } },
  })

  const itemsToCreate: {
    tripId: string
    activityId?: string
    date: Date
    startTime: string
    endTime: string
    type: "ACTIVITY" | "MEAL" | "TRANSIT" | "BUFFER"
    title: string
    notes?: string
    durationMins: number
    travelTimeToNextMins: number
    costEstimate: number
    position: number
  }[] = []

  let position = 0
  for (const day of aiResult) {
    for (const item of day.items) {
      itemsToCreate.push({
        tripId,
        activityId: item.activityId || undefined,
        date: new Date(day.date),
        startTime: item.startTime,
        endTime: item.endTime,
        type: item.type,
        title: item.title,
        notes: item.notes || undefined,
        durationMins: timeDiffMins(item.startTime, item.endTime),
        travelTimeToNextMins: item.travelTimeFromPrev || 0,
        costEstimate: 0,
        position: position++,
      })
    }
  }

  if (itemsToCreate.length > 0) {
    await prisma.itineraryItem.createMany({ data: itemsToCreate })

    // Update activity statuses for scheduled activities
    const scheduledActivityIds = itemsToCreate
      .filter((i) => i.activityId)
      .map((i) => i.activityId!)
    if (scheduledActivityIds.length > 0) {
      await prisma.activity.updateMany({
        where: { id: { in: scheduledActivityIds } },
        data: { status: "SCHEDULED" },
      })
    }
  }

  revalidatePath(`/trip/${tripId}/itinerary`)

  return {
    scheduledItems: itemsToCreate.filter((i) => i.type === "ACTIVITY"),
    unscheduled: [] as { activityId: string; reason: string }[],
    totalCost: 0,
    reasoning: aiResult.map((d) => `${d.date}: ${d.reasoning}`),
  }
}

function timeDiffMins(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

// Exported types derived from Prisma return types
export type ItineraryItemResult = Awaited<ReturnType<typeof createItineraryItem>>
export type ItineraryItemFull = Awaited<ReturnType<typeof getItinerary>>[number]
