"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { haversineDistance } from "@/lib/haversine"

// Re-use AIRPORT_COORDS from carbon.ts (importing would couple server action to client util)
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
  SYD: [-33.9461, 151.1772], MEL: [-37.6733, 144.8433], FCO: [41.8003, 12.2389],
  MAD: [40.4936, -3.5668], BCN: [41.2971, 2.0785], MUC: [48.3538, 11.786],
  DUB: [53.4213, -6.2701], IST: [41.2753, 28.7519], HKG: [22.308, 113.9185],
  SIN: [1.3644, 103.9915], ICN: [37.4602, 126.4407], PEK: [40.0799, 116.6031],
  DEL: [28.5562, 77.1], BOM: [19.0896, 72.8656], DXB: [25.2532, 55.3657],
  DOH: [25.2731, 51.6081], YYZ: [43.6777, -79.6248], YVR: [49.1939, -123.1844],
  GRU: [-23.4356, -46.4731], EZE: [-34.8222, -58.5358], MEX: [19.4363, -99.0721],
  CUN: [21.0365, -86.877], LIS: [38.7756, -9.1354], CPH: [55.618, 12.6508],
  OSL: [60.1976, 11.1004], ARN: [59.6519, 17.9186], HEL: [60.3172, 24.9633],
  ZRH: [47.4647, 8.5492], VIE: [48.1103, 16.5697], BRU: [50.9014, 4.4844],
  MAN: [53.3537, -2.275], EDI: [55.95, -3.3725], ATH: [37.9364, 23.9445],
  NBO: [-1.3192, 36.9278], JNB: [-26.1392, 28.246], CAI: [30.1219, 31.4056],
}

export interface TravelStats {
  totalTrips: number
  totalCities: number
  totalFlights: number
  totalDistanceKm: number
  totalHotelNights: number
  totalActivities: number
  mostVisitedCity: string | null
  longestTrip: { title: string; days: number } | null
  shortestTrip: { title: string; days: number } | null
  avgTripDuration: number
  tripsByStatus: { status: string; count: number }[]
  monthlyFrequency: { month: string; count: number }[]
  topAirlines: { airline: string; count: number }[]
  citiesVisited: string[]
  tripTimeline: { id: string; title: string; destination: string; startDate: string; endDate: string; status: string }[]
  funFacts: {
    earthCircumferences: number
    moonDistance: number
  }
}

export async function getTravelStats(): Promise<TravelStats> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const trips = await prisma.trip.findMany({
    where: { userId: session.user.id },
    include: {
      flights: true,
      hotels: true,
      activities: true,
      destinations: true,
    },
    orderBy: { startDate: "asc" },
  })

  // Total trips
  const totalTrips = trips.length

  // Cities visited (from destinations)
  const citiesSet = new Set<string>()
  for (const trip of trips) {
    for (const dest of trip.destinations) {
      citiesSet.add(dest.name)
    }
    // Fallback to trip.destination if no destinations
    if (trip.destinations.length === 0 && trip.destination) {
      trip.destination.split(",").forEach((c) => citiesSet.add(c.trim()))
    }
  }
  const citiesVisited = [...citiesSet].filter(Boolean)
  const totalCities = citiesVisited.length

  // Flights
  const allFlights = trips.flatMap((t) => t.flights)
  const totalFlights = allFlights.length

  // Total distance flown
  let totalDistanceKm = 0
  for (const f of allFlights) {
    if (!f.departureAirport || !f.arrivalAirport) continue
    const dep = AIRPORT_COORDS[f.departureAirport.toUpperCase().trim()]
    const arr = AIRPORT_COORDS[f.arrivalAirport.toUpperCase().trim()]
    if (dep && arr) {
      totalDistanceKm += haversineDistance(dep[0], dep[1], arr[0], arr[1])
    }
  }
  totalDistanceKm = Math.round(totalDistanceKm)

  // Hotel nights
  let totalHotelNights = 0
  for (const trip of trips) {
    for (const hotel of trip.hotels) {
      const checkIn = new Date(hotel.checkIn)
      const checkOut = new Date(hotel.checkOut)
      const nights = Math.max(0, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))
      totalHotelNights += nights
    }
  }

  // Activities
  const totalActivities = trips.reduce((sum, t) => sum + t.activities.length, 0)

  // Most visited city
  const cityCount = new Map<string, number>()
  for (const trip of trips) {
    for (const dest of trip.destinations) {
      cityCount.set(dest.name, (cityCount.get(dest.name) || 0) + 1)
    }
    if (trip.destinations.length === 0 && trip.destination) {
      trip.destination.split(",").forEach((c) => {
        const city = c.trim()
        if (city) cityCount.set(city, (cityCount.get(city) || 0) + 1)
      })
    }
  }
  let mostVisitedCity: string | null = null
  let maxVisits = 0
  cityCount.forEach((count, city) => {
    if (count > maxVisits) {
      maxVisits = count
      mostVisitedCity = city
    }
  })

  // Trip durations
  const tripDurations = trips.map((t) => {
    const days = Math.max(1, Math.ceil((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / (1000 * 60 * 60 * 24)))
    return { title: t.title, days }
  })
  const longestTrip = tripDurations.length > 0 ? tripDurations.reduce((a, b) => (a.days >= b.days ? a : b)) : null
  const shortestTrip = tripDurations.length > 0 ? tripDurations.reduce((a, b) => (a.days <= b.days ? a : b)) : null
  const avgTripDuration = tripDurations.length > 0 ? Math.round(tripDurations.reduce((s, t) => s + t.days, 0) / tripDurations.length) : 0

  // Trips by status
  const statusCounts = new Map<string, number>()
  for (const trip of trips) {
    statusCounts.set(trip.status, (statusCounts.get(trip.status) || 0) + 1)
  }
  const tripsByStatus = [...statusCounts.entries()].map(([status, count]) => ({ status, count }))

  // Monthly frequency
  const monthCounts = new Map<string, number>()
  for (const trip of trips) {
    const d = new Date(trip.startDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1)
  }
  const monthlyFrequency = [...monthCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }))

  // Top airlines
  const airlineCounts = new Map<string, number>()
  for (const f of allFlights) {
    if (f.airline) {
      airlineCounts.set(f.airline, (airlineCounts.get(f.airline) || 0) + 1)
    }
  }
  const topAirlines = [...airlineCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([airline, count]) => ({ airline, count }))

  // Trip timeline
  const tripTimeline = trips.map((t) => ({
    id: t.id,
    title: t.title,
    destination: t.destination,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    status: t.status,
  }))

  // Fun facts
  const earthCircumferenceKm = 40075
  const moonDistanceKm = 384400

  return {
    totalTrips,
    totalCities,
    totalFlights,
    totalDistanceKm,
    totalHotelNights,
    totalActivities,
    mostVisitedCity,
    longestTrip,
    shortestTrip,
    avgTripDuration,
    tripsByStatus,
    monthlyFrequency,
    topAirlines,
    citiesVisited,
    tripTimeline,
    funFacts: {
      earthCircumferences: Math.round((totalDistanceKm / earthCircumferenceKm) * 10) / 10,
      moonDistance: Math.round((totalDistanceKm / moonDistanceKm) * 100),
    },
  }
}
