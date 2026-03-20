import { notFound } from "next/navigation"
import { getActivities } from "@/lib/actions/activities"
import { getTrip } from "@/lib/actions/trips"
import { ActivitiesView } from "./activities-view"

export default async function ActivitiesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let activities: Awaited<ReturnType<typeof getActivities>>

  try {
    ;[trip, activities] = await Promise.all([getTrip(tripId), getActivities(tripId)])
  } catch {
    notFound()
  }

  // Build destinations list from trip destinations, with flight arrival city as potential default
  const destinations = trip.destinations.map((d) => d.name)
  const firstFlightArrivalCity = trip.flights.length > 0
    ? (trip.flights[0].arrivalCity || trip.flights[0].arrivalAirport || null)
    : null

  // Default search location: first flight arrival city, then first destination, then trip.destination
  const defaultSearchLocation = firstFlightArrivalCity || destinations[0] || trip.destination

  return (
    <ActivitiesView
      tripId={tripId}
      initialActivities={activities}
      destination={defaultSearchLocation}
      destinations={destinations}
    />
  )
}
