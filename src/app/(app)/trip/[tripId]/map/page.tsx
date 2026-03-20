import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { getItinerary } from "@/lib/actions/itinerary"
import { getPlacesApiKey } from "@/lib/actions/user"
import { TripMapClient } from "./map-client"

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
  function dateToDayIndex(date: Date): number {
    return Math.floor((new Date(date).getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))
  }

  // Hotels
  for (const hotel of trip.hotels) {
    if (hotel.lat && hotel.lng) {
      markers.push({
        lat: hotel.lat,
        lng: hotel.lng,
        label: hotel.name,
        type: "hotel",
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

  // Flight airports (from AIRPORT_COORDS in carbon.ts — we use a subset here)
  const AIRPORT_COORDS: Record<string, [number, number]> = {
    JFK: [40.6413, -73.7781], LAX: [33.9416, -118.4085], ORD: [41.9742, -87.9073],
    ATL: [33.6407, -84.4277], DFW: [32.8998, -97.0403], SFO: [37.6213, -122.379],
    SEA: [47.4502, -122.3088], MIA: [25.7959, -80.287], DEN: [39.8561, -104.6737],
    BOS: [42.3656, -71.0096], IAH: [29.9902, -95.3368], MSP: [44.8848, -93.2223],
    DTW: [42.2124, -83.3534], PHL: [39.8729, -75.2437], LGA: [40.7769, -73.874],
    EWR: [40.6895, -74.1745], CLT: [35.214, -80.9431], PHX: [33.4373, -112.0078],
    SAN: [32.7338, -117.1933], AUS: [30.1975, -97.6664], SAT: [29.5337, -98.4698],
    GRR: [42.8808, -85.5228], IAD: [38.9531, -77.4565], DCA: [38.8512, -77.0402],
    MCO: [28.4312, -81.308], BWI: [39.1754, -76.6684], SLC: [40.7884, -111.9778],
    PDX: [45.5898, -122.5951], BNA: [36.1263, -86.6774], RDU: [35.8776, -78.7875],
    LHR: [51.47, -0.4543], CDG: [49.0097, 2.5479], FRA: [50.0379, 8.5622],
    AMS: [52.3086, 4.7639], NRT: [35.7647, 140.3864], HND: [35.5494, 139.7798],
    SYD: [-33.9461, 151.1772], FCO: [41.8003, 12.2389], MAD: [40.4936, -3.5668],
    BCN: [41.2971, 2.0785], DUB: [53.4213, -6.2701], IST: [41.2753, 28.7519],
    HKG: [22.308, 113.9185], SIN: [1.3644, 103.9915], ICN: [37.4602, 126.4407],
    DXB: [25.2532, 55.3657], DOH: [25.2731, 51.6081], YYZ: [43.6777, -79.6248],
    YVR: [49.1939, -123.1844], MEX: [19.4363, -99.0721], CUN: [21.0365, -86.877],
    LIS: [38.7756, -9.1354], CPH: [55.618, 12.6508], ZRH: [47.4647, 8.5492],
  }

  for (const flight of trip.flights) {
    if (flight.departureAirport) {
      const coords = AIRPORT_COORDS[flight.departureAirport.toUpperCase().trim()]
      if (coords) {
        markers.push({
          lat: coords[0],
          lng: coords[1],
          label: `${flight.departureAirport} (${flight.airline || "Flight"})`,
          type: "flight",
          day: dateToDayIndex(flight.departureTime),
        })
      }
    }
    if (flight.arrivalAirport) {
      const coords = AIRPORT_COORDS[flight.arrivalAirport.toUpperCase().trim()]
      if (coords) {
        markers.push({
          lat: coords[0],
          lng: coords[1],
          label: `${flight.arrivalAirport} (${flight.airline || "Flight"})`,
          type: "flight",
          day: dateToDayIndex(flight.arrivalTime),
        })
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
    />
  )
}
