import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getTrip } from "@/lib/actions/trips"
import { getAllActivitiesForTrip, getDismissedPlaceIds } from "@/lib/actions/activities"
import { getItinerary } from "@/lib/actions/itinerary"
import { filterLayoverCities } from "@/lib/flight-utils"
import { DiscoverView } from "./discover-view"

export default async function DiscoverPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const session = await auth()
    const userId = session?.user?.id

    const [trip, activities, itineraryItems, dismissedIds, user] = await Promise.all([
      getTrip(tripId),
      getAllActivitiesForTrip(tripId),
      getItinerary(tripId),
      getDismissedPlaceIds(tripId),
      userId
        ? prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
        : null,
    ])

    const destinations = (trip.destinations || []).map((d) => ({
      name: d.name,
      lat: d.lat,
      lng: d.lng,
    }))

    // Extract hotels with coordinates for distance calculation
    const hotels = (trip.hotels || [])
      .filter((h) => h.name)
      .map((h) => ({
        name: h.name,
        lat: h.lat ?? null,
        lng: h.lng ?? null,
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
      <DiscoverView
        tripId={tripId}
        trip={{
          destination: trip.destination,
          startDate: trip.startDate.toISOString().split("T")[0],
          endDate: trip.endDate.toISOString().split("T")[0],
        }}
        savedActivities={activities.map((a) => ({
          ...a,
          indoorOutdoor: a.indoorOutdoor || "BOTH",
        }))}
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
        dismissedPlaceIds={dismissedIds}
        userPlan={user?.plan || "FREE"}
        hotels={hotels}
      />
    )
  } catch {
    notFound()
  }
}
