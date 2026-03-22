import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { getAllActivitiesForTrip } from "@/lib/actions/activities"
import { getItinerary } from "@/lib/actions/itinerary"
import { filterLayoverCities } from "@/lib/flight-utils"
import { ExploreView } from "./explore-view"

export default async function ExplorePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, activities, itineraryItems] = await Promise.all([
      getTrip(tripId),
      getAllActivitiesForTrip(tripId),
      getItinerary(tripId),
    ])

    const destinations = (trip.destinations || []).map((d) => ({
      name: d.name,
      lat: d.lat,
      lng: d.lng,
    }))

    const allArrivalCities = Array.from(
      new Set(
        (trip.flights || [])
          .map((f) => f.arrivalCity)
          .filter(Boolean) as string[]
      )
    )
    const arrivalCities = filterLayoverCities(trip.flights || [], allArrivalCities)

    // Extract traveler tags
    const travelerTags: string[] = []
    for (const tt of trip.travelers || []) {
      if (tt.traveler.tags) {
        travelerTags.push(...tt.traveler.tags)
      }
    }

    return (
      <ExploreView
        tripId={tripId}
        trip={{
          destination: trip.destination,
          startDate: trip.startDate.toISOString().split("T")[0],
          endDate: trip.endDate.toISOString().split("T")[0],
        }}
        savedActivities={activities}
        itineraryItems={itineraryItems.map((item) => ({
          id: item.id,
          date: item.date.toISOString().split("T")[0],
          startTime: item.startTime || undefined,
          endTime: item.endTime || undefined,
          title: item.title,
          type: item.type,
          activityId: item.activityId || undefined,
          durationMins: item.durationMins,
        }))}
        destinations={destinations}
        arrivalCities={arrivalCities}
        travelerTags={[...new Set(travelerTags)]}
      />
    )
  } catch {
    notFound()
  }
}
