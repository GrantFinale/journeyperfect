import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { DiningView } from "./dining-view"

export default async function DiningPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const trip = await getTrip(tripId)

    // Build destinations list from TripDestination records
    const destinations = (trip.destinations || []).map((d) => ({
      name: d.name,
      lat: d.lat,
      lng: d.lng,
    }))

    // Extract unique arrival cities from flights
    const arrivalCities = Array.from(
      new Set(
        (trip.flights || [])
          .map((f) => f.arrivalCity)
          .filter(Boolean) as string[]
      )
    )

    return (
      <DiningView
        tripId={tripId}
        destination={trip.destination}
        destinations={destinations}
        arrivalCities={arrivalCities}
      />
    )
  } catch {
    notFound()
  }
}
