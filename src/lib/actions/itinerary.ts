"use server"

import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { optimizeItinerary } from "@/lib/optimizer"
import { optimizeItineraryWithAI } from "@/lib/optimizer-ai"
import { hasFeature } from "@/lib/features"
import { getWeatherForecast } from "@/lib/weather"
import { z } from "zod"
import { formatDateInTimezone } from "@/lib/utils"

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

const itemSchema = z.object({
  date: z.string(),
  startTime: z.string().optional(),
  type: z.enum(["FLIGHT","HOTEL_CHECK_IN","HOTEL_CHECK_OUT","RENTAL_CAR_PICKUP","RENTAL_CAR_DROPOFF","ACTIVITY","MEAL","TRANSIT","BUFFER","CUSTOM"]),
  title: z.string().min(1),
  notes: z.string().optional(),
  activityId: z.string().optional(),
  flightId: z.string().optional(),
  hotelId: z.string().optional(),
  rentalCarId: z.string().optional(),
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
      rentalCar: true,
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
    where: { id: itemId, tripId },
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
  await prisma.itineraryItem.delete({ where: { id: itemId, tripId } })
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
  // Use timezone-aware date/time to avoid UTC date mismatch
  const fixedItems = [
    ...trip.flights.map(f => {
      const depTz = f.departureTimezone || "UTC"
      const arrTz = f.arrivalTimezone || "UTC"
      const localDepDate = formatDateInTimezone(f.departureTime, "yyyy-MM-dd", depTz)
      const localDepTime = formatDateInTimezone(f.departureTime, "HH:mm", depTz)
      const localArrDate = formatDateInTimezone(f.arrivalTime, "yyyy-MM-dd", arrTz)
      const localArrTime = formatDateInTimezone(f.arrivalTime, "HH:mm", arrTz)
      const durationMins = Math.ceil((f.arrivalTime.getTime() - f.departureTime.getTime()) / 60000)
      const title = `${f.airline || ""} ${f.flightNumber || "Flight"}${f.departureAirport || f.arrivalAirport ? ` · ${[f.departureAirport, f.arrivalAirport].filter(Boolean).join(" → ")}` : ""}`.trim()

      // Create two fixed blocks: departure and arrival (may be different days)
      const items: { id: string; type: "FLIGHT" | "HOTEL_CHECK_IN" | "HOTEL_CHECK_OUT"; date: Date; startTime: string; durationMins: number; title: string; lat: number | null; lng: number | null }[] = [
        {
          id: f.id + "-dep",
          type: "FLIGHT" as const,
          date: new Date(localDepDate + "T00:00:00"),
          startTime: localDepTime,
          durationMins: localDepDate === localArrDate ? durationMins : (24 * 60 - timeToMins(localDepTime)),
          title: `Depart ${title}`,
          lat: null,
          lng: null,
        },
      ]
      if (localDepDate !== localArrDate) {
        items.push({
          id: f.id + "-arr",
          type: "FLIGHT" as const,
          date: new Date(localArrDate + "T00:00:00"),
          startTime: "00:00",
          durationMins: timeToMins(localArrTime),
          title: `Arrive ${title}`,
          lat: null,
          lng: null,
        })
      }
      return items
    }).flat(),
    ...trip.hotels.flatMap(h => {
      // Hotels: check-in typically at 3 PM, check-out at 11 AM
      const checkInDate = h.checkIn.toISOString().split("T")[0]
      const checkOutDate = h.checkOut.toISOString().split("T")[0]
      return [
        { id: h.id + "-in", type: "HOTEL_CHECK_IN" as const, date: new Date(checkInDate + "T00:00:00"), startTime: "15:00", durationMins: 30, title: `Check in ${h.name}`, lat: h.lat, lng: h.lng },
        { id: h.id + "-out", type: "HOTEL_CHECK_OUT" as const, date: new Date(checkOutDate + "T00:00:00"), startTime: "11:00", durationMins: 30, title: `Check out ${h.name}`, lat: h.lat, lng: h.lng },
      ]
    }),
  ]

  // Determine arrival date/time at destination — block all time before this
  // The first inbound flight's arrival is when you're at the destination
  const sortedFlights = [...trip.flights].sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime())
  let arrivalAtDestination: { date: string; time: string } | null = null
  let departureFromDestination: { date: string; time: string } | null = null

  if (sortedFlights.length > 0) {
    // First flight = outbound, last flight = return
    const firstFlight = sortedFlights[0]
    const lastFlight = sortedFlights[sortedFlights.length - 1]
    const arrTz = firstFlight.arrivalTimezone || "UTC"
    arrivalAtDestination = {
      date: formatDateInTimezone(firstFlight.arrivalTime, "yyyy-MM-dd", arrTz),
      time: formatDateInTimezone(firstFlight.arrivalTime, "HH:mm", arrTz),
    }
    // If there's a connecting flight on the same day, use the last arrival
    for (const f of sortedFlights) {
      const depDate = formatDateInTimezone(f.departureTime, "yyyy-MM-dd", f.departureTimezone || "UTC")
      if (depDate === formatDateInTimezone(firstFlight.departureTime, "yyyy-MM-dd", firstFlight.departureTimezone || "UTC")) {
        // Same day as first departure = still outbound
        const aTz = f.arrivalTimezone || "UTC"
        arrivalAtDestination = {
          date: formatDateInTimezone(f.arrivalTime, "yyyy-MM-dd", aTz),
          time: formatDateInTimezone(f.arrivalTime, "HH:mm", aTz),
        }
      }
    }
    // Return flight blocks the departure day
    const depTz = lastFlight.departureTimezone || "UTC"
    departureFromDestination = {
      date: formatDateInTimezone(lastFlight.departureTime, "yyyy-MM-dd", depTz),
      time: formatDateInTimezone(lastFlight.departureTime, "HH:mm", depTz),
    }
  }

  // Add virtual "travel" blocks to prevent scheduling activities before arrival or after departure
  if (arrivalAtDestination) {
    // Block from midnight to arrival time on arrival day
    fixedItems.push({
      id: "arrival-block",
      type: "FLIGHT" as const,
      date: new Date(arrivalAtDestination.date + "T00:00:00"),
      startTime: "00:00",
      durationMins: timeToMins(arrivalAtDestination.time) + 60, // +1hr for getting out of airport
      title: "Arriving at destination",
      lat: null, lng: null,
    })
  }
  if (departureFromDestination) {
    // Block from 2hrs before departure to midnight on departure day
    const depMins = timeToMins(departureFromDestination.time)
    const blockStart = Math.max(0, depMins - 120) // 2hrs before flight
    fixedItems.push({
      id: "departure-block",
      type: "FLIGHT" as const,
      date: new Date(departureFromDestination.date + "T00:00:00"),
      startTime: `${String(Math.floor(blockStart / 60)).padStart(2, "0")}:${String(blockStart % 60).padStart(2, "0")}`,
      durationMins: 24 * 60 - blockStart,
      title: "Departing from destination",
      lat: null, lng: null,
    })
  }

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
    userId,
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

export async function updateItineraryItemNotes(tripId: string, itemId: string, userNotes: string) {
  await requireTripAccess(tripId, "EDITOR")

  await prisma.itineraryItem.update({
    where: { id: itemId },
    data: { userNotes: userNotes || null },
  })

  revalidatePath(`/trip/${tripId}/itinerary`)
}

function timeDiffMins(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

// Exported types derived from Prisma return types
export type ItineraryItemResult = Awaited<ReturnType<typeof createItineraryItem>>
export type ItineraryItemFull = Awaited<ReturnType<typeof getItinerary>>[number]
