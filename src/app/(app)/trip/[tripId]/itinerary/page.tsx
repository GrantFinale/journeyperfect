import { notFound } from "next/navigation"
import { getItinerary } from "@/lib/actions/itinerary"
import { getTrip } from "@/lib/actions/trips"
import { getTripWeather } from "@/lib/actions/weather"
import { ItineraryView } from "./itinerary-view"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"

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

  return (
    <ItineraryView
      tripId={tripId}
      initialItems={items as Parameters<typeof ItineraryView>[0]["initialItems"]}
      tripStartDate={trip.startDate}
      tripEndDate={trip.endDate}
      weather={weather}
      isPaid={isPaid}
    />
  )
}
