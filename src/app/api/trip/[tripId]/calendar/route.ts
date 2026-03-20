import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  try {
    await requireTripAccess(tripId)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    include: {
      itineraryItems: { orderBy: [{ date: "asc" }, { startTime: "asc" }] },
      flights: true,
      hotels: true,
    },
  })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const events: string[] = []

  // Itinerary items as events
  for (const item of trip.itineraryItems) {
    const dtStart = item.startTime
      ? `${formatICSDate(item.date)}T${item.startTime.replace(":", "")}00`
      : formatICSDate(item.date)
    const duration = item.durationMins || 60

    const lines = [
      "BEGIN:VEVENT",
      `UID:${item.id}@journeyperfect.com`,
      `DTSTART:${dtStart}`,
      `DURATION:PT${duration}M`,
      `SUMMARY:${escapeICS(item.title)}`,
      item.notes ? `DESCRIPTION:${escapeICS(item.notes)}` : "",
      `CATEGORIES:${item.type}`,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n")

    events.push(lines)
  }

  // Flights as events (if not already in itinerary)
  const itineraryFlightIds = new Set(trip.itineraryItems.filter((i) => i.flightId).map((i) => i.flightId))
  for (const flight of trip.flights) {
    if (itineraryFlightIds.has(flight.id)) continue

    const summary = [flight.airline, flight.flightNumber, flight.departureAirport, "->", flight.arrivalAirport]
      .filter(Boolean)
      .join(" ")

    const durationMs = flight.arrivalTime.getTime() - flight.departureTime.getTime()
    const durationMins = Math.max(Math.round(durationMs / 60000), 30)

    const lines = [
      "BEGIN:VEVENT",
      `UID:flight-${flight.id}@journeyperfect.com`,
      `DTSTART:${formatICSDateTime(flight.departureTime)}`,
      `DTEND:${formatICSDateTime(flight.arrivalTime)}`,
      `SUMMARY:${escapeICS(summary)}`,
      flight.confirmationNumber ? `DESCRIPTION:Confirmation: ${escapeICS(flight.confirmationNumber)}` : "",
      "CATEGORIES:FLIGHT",
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n")

    events.push(lines)
  }

  // Hotels as events (check-in/check-out)
  const itineraryHotelIds = new Set(trip.itineraryItems.filter((i) => i.hotelId).map((i) => i.hotelId))
  for (const hotel of trip.hotels) {
    if (itineraryHotelIds.has(hotel.id)) continue

    // Check-in event
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:hotel-checkin-${hotel.id}@journeyperfect.com`,
        `DTSTART;VALUE=DATE:${formatICSDate(hotel.checkIn)}`,
        `DTEND;VALUE=DATE:${formatICSDate(addDays(hotel.checkIn, 1))}`,
        `SUMMARY:${escapeICS(`Check in: ${hotel.name}`)}`,
        hotel.address ? `LOCATION:${escapeICS(hotel.address)}` : "",
        hotel.confirmationNumber ? `DESCRIPTION:Confirmation: ${escapeICS(hotel.confirmationNumber)}` : "",
        "CATEGORIES:HOTEL_CHECK_IN",
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n")
    )

    // Check-out event
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:hotel-checkout-${hotel.id}@journeyperfect.com`,
        `DTSTART;VALUE=DATE:${formatICSDate(hotel.checkOut)}`,
        `DTEND;VALUE=DATE:${formatICSDate(addDays(hotel.checkOut, 1))}`,
        `SUMMARY:${escapeICS(`Check out: ${hotel.name}`)}`,
        hotel.address ? `LOCATION:${escapeICS(hotel.address)}` : "",
        "CATEGORIES:HOTEL_CHECK_OUT",
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n")
    )
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JourneyPerfect//Trip//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(trip.title)}`,
    ...events,
    "END:VCALENDAR",
  ].join("\r\n")

  const filename = trip.title.replace(/[^a-zA-Z0-9]/g, "_")

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.ics"`,
    },
  })
}

function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0].split("T")[0]
}

function formatICSDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
}

function escapeICS(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + days)
  return result
}
