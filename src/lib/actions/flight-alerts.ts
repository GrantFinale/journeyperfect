"use server"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { requireTripAccess } from "@/lib/auth-trip"

export interface FlightStatus {
  flightNumber: string
  status:
    | "scheduled"
    | "active"
    | "landed"
    | "cancelled"
    | "diverted"
    | "delayed"
    | "unknown"
  departureGate?: string
  departureTerminal?: string
  arrivalGate?: string
  arrivalTerminal?: string
  delayMinutes?: number
  actualDeparture?: string
  actualArrival?: string
  lastChecked: string
}

// Check flight status using AviationStack or similar API
export async function checkFlightStatus(
  flightNumber: string,
  date: string
): Promise<FlightStatus | null> {
  const apiKey = await getConfig("api.aviationstack.key", "")
  if (!apiKey) return null

  try {
    const res = await fetch(
      `https://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flightNumber}&flight_date=${date}`,
      { next: { revalidate: 300 } } // cache 5 minutes
    )

    if (!res.ok) return null

    const data = await res.json()
    const flight = data.data?.[0]
    if (!flight) return null

    return {
      flightNumber,
      status: flight.flight_status || "unknown",
      departureGate: flight.departure?.gate,
      departureTerminal: flight.departure?.terminal,
      arrivalGate: flight.arrival?.gate,
      arrivalTerminal: flight.arrival?.terminal,
      delayMinutes: flight.departure?.delay || 0,
      actualDeparture: flight.departure?.actual,
      actualArrival: flight.arrival?.actual,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    console.error("[flight-alerts] Status check failed:", err)
    return null
  }
}

// Check status for a single flight by flight number and date (client-callable)
export async function getSingleFlightStatus(
  tripId: string,
  flightNumber: string,
  departureDate: string
): Promise<FlightStatus | null> {
  await requireTripAccess(tripId)
  return checkFlightStatus(flightNumber, departureDate)
}

// Get flight statuses for all flights in a trip
export async function getTripFlightStatuses(
  tripId: string
): Promise<FlightStatus[]> {
  await requireTripAccess(tripId)

  const flights = await prisma.flight.findMany({
    where: { tripId },
    select: { flightNumber: true, departureTime: true },
  })

  const statuses: FlightStatus[] = []

  for (const f of flights) {
    if (!f.flightNumber) continue
    const date = f.departureTime.toISOString().split("T")[0]
    const status = await checkFlightStatus(f.flightNumber, date)
    if (status) statuses.push(status)
  }

  return statuses
}
