import { notFound } from "next/navigation"
import { getPackingList } from "@/lib/actions/packing"
import { getTrip } from "@/lib/actions/trips"
import { getUserPlan } from "@/lib/actions/user"
import { PackingView } from "./packing-view"

export default async function PackingPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, packingList, plan] = await Promise.all([
      getTrip(tripId),
      getPackingList(tripId),
      getUserPlan(),
    ])
    return (
      <PackingView
        tripId={tripId}
        initialData={packingList}
        tripTitle={trip.title}
        userPlan={plan}
      />
    )
  } catch {
    notFound()
  }
}
