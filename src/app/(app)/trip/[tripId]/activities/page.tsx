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

  return <ActivitiesView tripId={tripId} initialActivities={activities} destination={trip.destination} />
}
