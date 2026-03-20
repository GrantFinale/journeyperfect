import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { filterLayoverCities } from "@/lib/flight-utils"
import { DiningView } from "./dining-view"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"

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

    // Extract unique arrival cities from flights, filtering out layover cities
    const allArrivalCities = Array.from(
      new Set(
        (trip.flights || [])
          .map((f) => f.arrivalCity)
          .filter(Boolean) as string[]
      )
    )
    const arrivalCities = filterLayoverCities(trip.flights || [], allArrivalCities)

    // Check paid status
    const session = await auth()
    let isPaid = false
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { plan: true },
      })
      isPaid = !!user && hasFeature(user.plan, "aiFlightParsing")
    }

    return (
      <DiningView
        tripId={tripId}
        destination={trip.destination}
        destinations={destinations}
        arrivalCities={arrivalCities}
        isPaid={isPaid}
      />
    )
  } catch {
    notFound()
  }
}
