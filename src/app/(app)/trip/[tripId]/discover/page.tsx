import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { DiscoverView } from "./discover-view"

export default async function DiscoverPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const trip = await getTrip(tripId)
    return <DiscoverView tripId={tripId} destination={trip.destination} />
  } catch {
    notFound()
  }
}
