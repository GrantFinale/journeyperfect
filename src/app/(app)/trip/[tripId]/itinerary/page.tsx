import { notFound } from "next/navigation"
import { getItinerary } from "@/lib/actions/itinerary"
import { getTrip } from "@/lib/actions/trips"
import { getTripWeather } from "@/lib/actions/weather"
import { ItineraryView } from "./itinerary-view"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"
import { requireTripAccess } from "@/lib/auth-trip"
import { getPreferences } from "@/lib/actions/preferences"

export default async function ItineraryPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let items: Awaited<ReturnType<typeof getItinerary>>

  try {
    ;[trip, items] = await Promise.all([getTrip(tripId), getItinerary(tripId)])
  } catch {
    notFound()
  }

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

  // Fetch weather data (non-blocking — null if unavailable)
  const weather = await getTripWeather(tripId)

  // Fetch wishlist activities for the sidebar
  await requireTripAccess(tripId)
  const wishlistActivities = await prisma.activity.findMany({
    where: { tripId, status: "WISHLIST" },
    select: {
      id: true,
      name: true,
      durationMins: true,
      priority: true,
      indoorOutdoor: true,
      imageUrl: true,
      category: true,
      lat: true,
      lng: true,
      address: true,
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  })

  // Fetch user preferences for free time display
  const userPrefs = await getPreferences().catch(() => null)

  // Fetch hotels for travel time calculations
  const hotels = await prisma.hotel.findMany({
    where: { tripId },
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      checkIn: true,
      checkOut: true,
    },
    orderBy: { checkIn: "asc" },
  })

  const destinations = (trip.destinations || []).map((d) => ({
    name: d.name,
    lat: d.lat,
    lng: d.lng,
  }))

  return (
    <ItineraryView
      tripId={tripId}
      initialItems={items as Parameters<typeof ItineraryView>[0]["initialItems"]}
      tripStartDate={trip.startDate}
      tripEndDate={trip.endDate}
      weather={weather}
      isPaid={isPaid}
      wishlistActivities={wishlistActivities}
      hotels={hotels}
      showFreeTime={userPrefs?.showFreeTime ?? false}
      freeTimeMinGapHours={userPrefs?.freeTimeMinGapHours ?? 2}
      destinations={destinations}
    />
  )
}
