import { notFound } from "next/navigation"
import { getActivities } from "@/lib/actions/activities"
import { getTrip } from "@/lib/actions/trips"
import { filterLayoverCities } from "@/lib/flight-utils"
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

  // Build destinations list from TripDestination records (with lat/lng)
  const destinations = (trip.destinations || []).map((d) => ({
    name: d.name,
    lat: d.lat,
    lng: d.lng,
  }))

  // Extract unique arrival cities from flights, filtering out layover cities
  const allArrivalCities = Array.from(
    new Set(
      (trip.flights || [])
        .map((f) => f.arrivalCity)
        .filter(Boolean) as string[]
    )
  )
  const arrivalCities = filterLayoverCities(trip.flights || [], allArrivalCities)

  return (
    <ActivitiesView
      tripId={tripId}
      initialActivities={activities}
      destination={trip.destination}
      destinations={destinations}
      arrivalCities={arrivalCities}
    />
  )
}
