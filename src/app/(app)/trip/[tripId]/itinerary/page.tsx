import { notFound } from "next/navigation"
import { getItinerary } from "@/lib/actions/itinerary"
import { getTrip } from "@/lib/actions/trips"
import { ItineraryView } from "./itinerary-view"

export default async function ItineraryPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let items: Awaited<ReturnType<typeof getItinerary>>

  try {
    ;[trip, items] = await Promise.all([getTrip(tripId), getItinerary(tripId)])
  } catch {
    notFound()
  }

  return (
    <ItineraryView
      tripId={tripId}
      initialItems={items as Parameters<typeof ItineraryView>[0]["initialItems"]}
      tripStartDate={trip.startDate}
      tripEndDate={trip.endDate}
    />
  )
}
