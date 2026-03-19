import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { DiningView } from "./dining-view"

export default async function DiningPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const trip = await getTrip(tripId)
    return <DiningView tripId={tripId} destination={trip.destination} />
  } catch {
    notFound()
  }
}
