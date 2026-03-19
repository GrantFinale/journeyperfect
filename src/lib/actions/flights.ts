"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { parseFlightText } from "@/lib/flight-parser"
import { z } from "zod"

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
  return parseFlightText(text)
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
