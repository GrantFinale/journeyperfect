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
      itineraryItems: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: { activity: true },
      },
      flights: true,
      hotels: true,
      rentalCars: true,
    },
  })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const now = formatICSDateTime(new Date())
  const events: string[] = []

  // Itinerary items as events
  for (const item of trip.itineraryItems) {
    const isAllDay = !item.startTime
    const dtStart = item.startTime
      ? `${formatICSDate(item.date)}T${item.startTime.replace(":", "")}00`
      : formatICSDate(item.date)
    const duration = item.durationMins || 60

    // Add emoji prefix based on type
    const emoji = typeEmoji(item.type)
    const summary = emoji ? `${emoji} ${item.title}` : item.title

    const lines = [
      "BEGIN:VEVENT",
      `UID:${item.id}@journeyperfect.com`,
      `DTSTAMP:${now}`,
      isAllDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`,
      isAllDay ? "" : `DURATION:PT${duration}M`,
      `SUMMARY:${escapeICS(summary)}`,
      item.notes ? `DESCRIPTION:${escapeICS(item.notes)}` : "",
      item.activity?.address ? `LOCATION:${escapeICS(item.activity.address)}` : "",
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

    const route = flight.departureAirport && flight.arrivalAirport
      ? `${flight.departureAirport}\u2192${flight.arrivalAirport}`
      : ""
    const flightLabel = [flight.airline, flight.flightNumber].filter(Boolean).join(" ")
    const summary = `\u2708\uFE0F ${flightLabel} ${route}`.trim()

    const desc = [
      flight.confirmationNumber ? `Confirmation: ${flight.confirmationNumber}` : "",
      flight.departureAirport ? `Departs: ${flight.departureAirport}` : "",
      flight.arrivalAirport ? `Arrives: ${flight.arrivalAirport}` : "",
    ].filter(Boolean).join("\\n")

    const lines = [
      "BEGIN:VEVENT",
      `UID:flight-${flight.id}@journeyperfect.com`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatICSDateTime(flight.departureTime)}`,
      `DTEND:${formatICSDateTime(flight.arrivalTime)}`,
      `SUMMARY:${escapeICS(summary)}`,
      desc ? `DESCRIPTION:${escapeICS(desc)}` : "",
      flight.departureAirport ? `LOCATION:${escapeICS(flight.departureAirport)}` : "",
      "CATEGORIES:FLIGHT",
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n")

    events.push(lines)
  }

  // Hotels as all-day spanning events
  const itineraryHotelIds = new Set(trip.itineraryItems.filter((i) => i.hotelId).map((i) => i.hotelId))
  for (const hotel of trip.hotels) {
    if (itineraryHotelIds.has(hotel.id)) continue

    const desc = [
      hotel.confirmationNumber ? `Confirmation: ${hotel.confirmationNumber}` : "",
    ].filter(Boolean).join("\\n")

    // Single spanning event for the full stay
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:hotel-${hotel.id}@journeyperfect.com`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${formatICSDate(hotel.checkIn)}`,
        `DTEND;VALUE=DATE:${formatICSDate(hotel.checkOut)}`,
        `SUMMARY:${escapeICS(`\uD83C\uDFE8 ${hotel.name}`)}`,
        hotel.address ? `LOCATION:${escapeICS(hotel.address)}` : "",
        desc ? `DESCRIPTION:${escapeICS(desc)}` : "",
        "CATEGORIES:HOTEL",
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n")
    )
  }

  // Rental cars as events
  const itineraryCarIds = new Set(trip.itineraryItems.filter((i) => i.rentalCarId).map((i) => i.rentalCarId))
  for (const car of trip.rentalCars) {
    if (itineraryCarIds.has(car.id)) continue

    const carLabel = [car.company, car.vehicleType].filter(Boolean).join(" - ") || "Rental Car"
    const desc = [
      car.confirmationNumber ? `Confirmation: ${car.confirmationNumber}` : "",
      car.pickupLocation ? `Pickup: ${car.pickupLocation}` : "",
      car.dropoffLocation ? `Dropoff: ${car.dropoffLocation}` : "",
    ].filter(Boolean).join("\\n")

    // Pickup event
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:car-pickup-${car.id}@journeyperfect.com`,
        `DTSTAMP:${now}`,
        `DTSTART:${formatICSDateTime(car.pickupTime)}`,
        `DURATION:PT30M`,
        `SUMMARY:${escapeICS(`\uD83D\uDE97 Pickup: ${carLabel}`)}`,
        car.pickupAddress ? `LOCATION:${escapeICS(car.pickupAddress)}` : "",
        desc ? `DESCRIPTION:${escapeICS(desc)}` : "",
        "CATEGORIES:RENTAL_CAR_PICKUP",
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n")
    )

    // Dropoff event
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:car-dropoff-${car.id}@journeyperfect.com`,
        `DTSTAMP:${now}`,
        `DTSTART:${formatICSDateTime(car.dropoffTime)}`,
        `DURATION:PT30M`,
        `SUMMARY:${escapeICS(`\uD83D\uDE97 Dropoff: ${carLabel}`)}`,
        car.dropoffAddress ? `LOCATION:${escapeICS(car.dropoffAddress)}` : "",
        desc ? `DESCRIPTION:${escapeICS(desc)}` : "",
        "CATEGORIES:RENTAL_CAR_DROPOFF",
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
    "X-WR-TIMEZONE:UTC",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n")

  const filename = trip.title.replace(/[^a-zA-Z0-9]/g, "_")

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

function typeEmoji(type: string): string {
  switch (type) {
    case "FLIGHT": return "\u2708\uFE0F"
    case "HOTEL_CHECK_IN": return "\uD83C\uDFE8"
    case "HOTEL_CHECK_OUT": return "\uD83C\uDFE8"
    case "RENTAL_CAR_PICKUP":
    case "RENTAL_CAR_DROPOFF": return "\uD83D\uDE97"
    case "ACTIVITY": return "\uD83C\uDFAF"
    case "MEAL": return "\uD83C\uDF7D\uFE0F"
    case "TRANSIT": return "\uD83D\uDE8C"
    default: return ""
  }
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
