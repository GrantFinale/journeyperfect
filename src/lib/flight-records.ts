import { prisma } from "@/lib/db"
import { formatDateInTimezone } from "@/lib/utils"
import { z } from "zod"

/**
 * Session-free core of `createFlight` in `src/lib/actions/flights.ts`: creates
 * the Flight row, its FLIGHT itinerary item (dated in the departure timezone),
 * an optional FLIGHTS budget item, and extends the trip's end date when the
 * arrival lands after it.
 *
 * The MCP `add_flight` tool calls this directly because the server action
 * module is `"use server"` and authenticates with a NextAuth session. The
 * action's `createFlight` delegates here and adds `revalidatePath`, which has
 * no meaning outside a request from the app.
 */
const text = z.string().max(200)

export const flightRecordSchema = z.object({
  airline: text.optional(),
  flightNumber: text.optional(),
  departureAirport: text.optional(),
  departureCity: text.optional(),
  departureTime: z.string().max(200),
  departureTimezone: text.default("UTC"),
  arrivalAirport: text.optional(),
  arrivalCity: text.optional(),
  arrivalTime: z.string().max(200),
  arrivalTimezone: text.default("UTC"),
  confirmationNumber: text.optional(),
  bookingLink: z.string().max(2048).optional(),
  cabin: text.optional(),
  notes: z.string().max(5000).optional(),
  durationMins: z.number().optional(),
  price: z.number().optional(),
  priceCurrency: z.string().max(10).optional(),
})

export type FlightRecordInput = z.input<typeof flightRecordSchema>

export function flightItineraryTitle(parsed: { airline?: string; flightNumber?: string; departureAirport?: string; arrivalAirport?: string }) {
  const route = [parsed.departureAirport, parsed.arrivalAirport].filter(Boolean).join(" → ")
  return `${parsed.airline || ""} ${parsed.flightNumber || "Flight"}${route ? ` · ${route}` : ""}`.trim()
}

export async function createFlightWithItinerary(tripId: string, data: FlightRecordInput) {
  const parsed = flightRecordSchema.parse(data)
  const depTime = new Date(parsed.departureTime)
  const arrTime = new Date(parsed.arrivalTime)
  if (Number.isNaN(depTime.getTime())) throw new Error("departureTime is not a valid date-time")
  if (Number.isNaN(arrTime.getTime())) throw new Error("arrivalTime is not a valid date-time")

  const flight = await prisma.flight.create({
    data: {
      tripId,
      ...parsed,
      departureTime: depTime,
      arrivalTime: arrTime,
    },
  })

  // Auto-create itinerary item, dated in the departure timezone so it shows on
  // the correct local day.
  const calcDuration = Math.ceil((arrTime.getTime() - depTime.getTime()) / 60000)
  const durationMins = parsed.durationMins || calcDuration
  const depTz = parsed.departureTimezone || "UTC"
  const localDate = formatDateInTimezone(depTime, "yyyy-MM-dd", depTz)
  const localTime = formatDateInTimezone(depTime, "HH:mm", depTz)
  const localEndTime = formatDateInTimezone(arrTime, "HH:mm", depTz)
  const itineraryItem = await prisma.itineraryItem.create({
    data: {
      tripId,
      flightId: flight.id,
      date: new Date(localDate + "T00:00:00Z"),
      startTime: localTime,
      endTime: localEndTime,
      type: "FLIGHT",
      title: flightItineraryTitle(parsed),
      durationMins,
      position: 0,
      isConfirmed: true,
    },
  })

  // Auto-create BudgetItem for flight cost
  if (parsed.price) {
    await prisma.budgetItem.create({
      data: {
        tripId,
        category: "FLIGHTS",
        title: `${parsed.airline || ""} ${parsed.flightNumber || "Flight"} ${[parsed.departureAirport, parsed.arrivalAirport].filter(Boolean).join(" → ")}`.trim(),
        amount: parsed.price,
        currency: parsed.priceCurrency || "USD",
        isEstimate: false,
      },
    })
  }

  // Auto-update trip end date if flight arrival extends beyond current end
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { endDate: true } })
  if (trip && arrTime > trip.endDate) {
    await prisma.trip.update({ where: { id: tripId }, data: { endDate: arrTime } })
  }

  return { flight, itineraryItem }
}
