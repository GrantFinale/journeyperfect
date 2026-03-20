/**
 * Layover detection utilities for filtering out short-stay cities
 * from destination/arrival city lists.
 */

const LAYOVER_THRESHOLD_MS = 3 * 60 * 60 * 1000 // 3 hours in milliseconds

interface FlightLike {
  departureCity?: string | null
  departureAirport?: string | null
  departureTime: Date | string
  arrivalCity?: string | null
  arrivalAirport?: string | null
  arrivalTime: Date | string
}

/**
 * Returns true if the given city is just a layover — meaning someone arrives
 * and departs within 3 hours without a real stay.
 */
export function isLayoverCity(flights: FlightLike[], city: string): boolean {
  const arrivals = flights.filter(
    (f) => f.arrivalCity === city || f.arrivalAirport === city
  )
  const departures = flights.filter(
    (f) => f.departureCity === city || f.departureAirport === city
  )

  for (const arr of arrivals) {
    for (const dep of departures) {
      const arrTime = new Date(arr.arrivalTime).getTime()
      const depTime = new Date(dep.departureTime).getTime()
      const gap = depTime - arrTime
      if (gap > 0 && gap < LAYOVER_THRESHOLD_MS) return true
    }
  }
  return false
}

/**
 * Filters an array of city names, removing any that are layover cities.
 */
export function filterLayoverCities(flights: FlightLike[], cities: string[]): string[] {
  return cities.filter((city) => !isLayoverCity(flights, city))
}
