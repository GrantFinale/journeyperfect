import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { getItinerary } from "@/lib/actions/itinerary"
import { getPlacesApiKey } from "@/lib/actions/user"
import { formatDateInTimezone } from "@/lib/utils"
import { TripMapClient } from "./map-client"
import { getAirportCoords } from "@/lib/airports"

export default async function TripMapPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let items: Awaited<ReturnType<typeof getItinerary>>

  try {
    ;[trip, items] = await Promise.all([getTrip(tripId), getItinerary(tripId)])
  } catch {
    notFound()
  }

  const apiKey = await getPlacesApiKey()

  // Build markers from activities, hotels, and flight airports
  const markers: {
    lat: number
    lng: number
    label: string
    type: "activity" | "hotel" | "flight" | "restaurant" | "transit"
    day?: number
  }[] = []

  // Build a date-to-day-index map
  const tripStart = new Date(trip.startDate)
  const tripStartDateStr = tripStart.toISOString().slice(0, 10) // "YYYY-MM-DD"
  function dateToDayIndex(date: Date): number {
    return Math.floor((new Date(date).getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))
  }
  // Timezone-aware version: determines the day index based on the local date
  // in the given timezone, not UTC. This is crucial for flights that cross timezones.
  function dateToDayIndexTz(date: Date, timezone?: string): number {
    if (!timezone || timezone === "UTC") return dateToDayIndex(date)
    const localDateStr = formatDateInTimezone(date, "yyyy-MM-dd", timezone)
    // Parse both as simple date strings to get day difference
    const [sy, sm, sd] = tripStartDateStr.split("-").map(Number)
    const [ly, lm, ld] = localDateStr.split("-").map(Number)
    const startMs = Date.UTC(sy, sm - 1, sd)
    const localMs = Date.UTC(ly, lm - 1, ld)
    return Math.floor((localMs - startMs) / (1000 * 60 * 60 * 24))
  }

  // Hotels — build markers and hotel-to-day mapping
  const hotelsForDays: {
    lat: number
    lng: number
    name: string
    checkInDay: number
    checkOutDay: number
  }[] = []

  for (const hotel of trip.hotels) {
    if (hotel.lat && hotel.lng) {
      markers.push({
        lat: hotel.lat,
        lng: hotel.lng,
        label: hotel.name,
        type: "hotel",
      })
      hotelsForDays.push({
        lat: hotel.lat,
        lng: hotel.lng,
        name: hotel.name,
        checkInDay: dateToDayIndex(hotel.checkIn),
        checkOutDay: dateToDayIndex(hotel.checkOut),
      })
    }
  }

  // Activities from itinerary items with linked activities that have lat/lng
  for (const item of items) {
    const it = item as any
    if (it.activity?.lat && it.activity?.lng) {
      markers.push({
        lat: it.activity.lat,
        lng: it.activity.lng,
        label: it.title,
        type: it.type === "MEAL" ? "restaurant" : "activity",
        day: dateToDayIndex(it.date),
      })
    }
  }

  // Airport positions come from the shared IATA table in @/lib/airports, which
  // covers far more codes than the local subset this page used to carry.

  // Sort flights chronologically to identify home airport and layovers
  const sortedFlights = [...trip.flights].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
  )

  // Identify home airport: the departure airport of the first chronological flight
  const homeAirport = sortedFlights.length > 0
    ? sortedFlights[0].departureAirport?.toUpperCase().trim() || null
    : null

  // Identify layover airports: arrival airports where the next flight departs
  // from the same airport within 4 hours
  const layoverAirports = new Set<string>()
  for (let i = 0; i < sortedFlights.length - 1; i++) {
    const current = sortedFlights[i]
    const next = sortedFlights[i + 1]
    const arrAirport = current.arrivalAirport?.toUpperCase().trim()
    const nextDeptAirport = next.departureAirport?.toUpperCase().trim()
    if (arrAirport && nextDeptAirport && arrAirport === nextDeptAirport) {
      const arrTime = new Date(current.arrivalTime).getTime()
      const nextDeptTime = new Date(next.departureTime).getTime()
      const layoverHours = (nextDeptTime - arrTime) / (1000 * 60 * 60)
      if (layoverHours > 0 && layoverHours < 4) {
        layoverAirports.add(arrAirport)
      }
    }
  }

  for (const flight of sortedFlights) {
    // Add departure airport marker only if it's not the home airport and not a layover
    if (flight.departureAirport) {
      const code = flight.departureAirport.toUpperCase().trim()
      if (code !== homeAirport && !layoverAirports.has(code)) {
        const coords = getAirportCoords(code)
        if (coords) {
          markers.push({
            lat: coords.lat,
            lng: coords.lng,
            label: `${flight.departureAirport} (${flight.airline || "Flight"})`,
            type: "flight",
            day: dateToDayIndexTz(flight.departureTime, flight.departureTimezone || undefined),
          })
        }
      }
    }
    // Add arrival airport marker only if it's not the home airport and not a layover
    if (flight.arrivalAirport) {
      const code = flight.arrivalAirport.toUpperCase().trim()
      if (code !== homeAirport && !layoverAirports.has(code)) {
        const coords = getAirportCoords(code)
        if (coords) {
          markers.push({
            lat: coords.lat,
            lng: coords.lng,
            label: `${flight.arrivalAirport} (${flight.airline || "Flight"})`,
            type: "flight",
            day: dateToDayIndexTz(flight.arrivalTime, flight.arrivalTimezone || undefined),
          })
        }
      }
    }
  }

  // Compute total days
  const totalDays = Math.max(
    1,
    Math.ceil((new Date(trip.endDate).getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  )

  // Center on destination or first marker
  const center = trip.destinationLat && trip.destinationLng
    ? { lat: trip.destinationLat, lng: trip.destinationLng }
    : markers.length > 0
      ? { lat: markers[0].lat, lng: markers[0].lng }
      : undefined

  return (
    <TripMapClient
      markers={markers}
      center={center}
      apiKey={apiKey}
      totalDays={totalDays}
      tripTitle={trip.title}
      hotels={hotelsForDays}
    />
  )
}
