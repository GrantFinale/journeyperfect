"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { parseFlightTextWithAI } from "@/lib/flight-parser-ai"
import { z } from "zod"
import { hasFeature } from "@/lib/features"

const flightSchema = z.object({
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  departureAirport: z.string().optional(),
  departureCity: z.string().optional(),
  departureTime: z.string(),
  departureTimezone: z.string().default("UTC"),
  arrivalAirport: z.string().optional(),
  arrivalCity: z.string().optional(),
  arrivalTime: z.string(),
  arrivalTimezone: z.string().default("UTC"),
  confirmationNumber: z.string().optional(),
  bookingLink: z.string().optional(),
  cabin: z.string().optional(),
  notes: z.string().optional(),
})

export async function parseAndPreviewFlight(text: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })

  // AI parsing is a paid feature
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED:AI flight parsing requires a paid plan. Please enter flight details manually or upgrade your plan.")
  }

  const aiResult = await parseFlightTextWithAI(text)
  if (aiResult && aiResult.flights.length > 0) {
    return aiResult
  }

  // AI failed — tell user to enter manually
  throw new Error("PARSE_FAILED:Could not parse flight details. Please enter them manually.")
}

export async function createFlight(tripId: string, data: z.infer<typeof flightSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const parsed = flightSchema.parse(data)
  const flight = await prisma.flight.create({
    data: {
      tripId,
      ...parsed,
      departureTime: new Date(parsed.departureTime),
      arrivalTime: new Date(parsed.arrivalTime),
    },
  })

  // Auto-create itinerary items for departure and arrival
  await prisma.itineraryItem.createMany({
    data: [
      {
        tripId,
        flightId: flight.id,
        date: new Date(parsed.departureTime),
        startTime: new Date(parsed.departureTime).toTimeString().slice(0, 5),
        type: "FLIGHT",
        title: `✈ ${parsed.flightNumber || "Flight"} ${parsed.departureAirport || ""} → ${parsed.arrivalAirport || ""}`,
        durationMins: Math.ceil(
          (new Date(parsed.arrivalTime).getTime() - new Date(parsed.departureTime).getTime()) / 60000
        ),
        position: 0,
        isConfirmed: true,
      },
    ],
  })

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return flight
}

export async function createFlightsBatch(tripId: string, flights: z.infer<typeof flightSchema>[]) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not authenticated")

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: session.user.id },
  })
  if (!trip) throw new Error("Trip not found")

  await prisma.$transaction(
    flights.map((flight) => {
      const parsed = flightSchema.parse(flight)
      const depTime = new Date(parsed.departureTime)
      const arrTime = new Date(parsed.arrivalTime)
      return prisma.flight.create({
        data: {
          tripId,
          ...parsed,
          departureTime: depTime,
          arrivalTime: arrTime,
          itineraryItems: {
            create: {
              tripId,
              date: depTime,
              startTime: depTime.toTimeString().slice(0, 5),
              endTime: arrTime.toTimeString().slice(0, 5),
              type: "FLIGHT",
              title: `${parsed.airline || ""} ${parsed.flightNumber || "Flight"}`.trim(),
              durationMins: Math.round(
                (arrTime.getTime() - depTime.getTime()) / 60000
              ),
              position: 0,
              isConfirmed: true,
              costEstimate: 0,
            },
          },
        },
      })
    })
  )

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
}

export async function updateFlight(tripId: string, flightId: string, data: Partial<z.infer<typeof flightSchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.flight.update({
    where: { id: flightId },
    data: {
      ...data,
      ...(data.departureTime && { departureTime: new Date(data.departureTime) }),
      ...(data.arrivalTime && { arrivalTime: new Date(data.arrivalTime) }),
    },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function deleteFlight(tripId: string, flightId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.flight.delete({ where: { id: flightId } })
  revalidatePath(`/trip/${tripId}`)
}
