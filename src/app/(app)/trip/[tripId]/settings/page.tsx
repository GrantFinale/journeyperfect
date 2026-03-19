import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { getTravelerProfiles } from "@/lib/actions/travelers"
import { TripSettingsView } from "./trip-settings-view"

export default async function TripSettingsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, allProfiles] = await Promise.all([getTrip(tripId), getTravelerProfiles()])
    return (
      <TripSettingsView
        tripId={tripId}
        trip={trip}
        allProfiles={allProfiles}
      />
    )
  } catch {
    notFound()
  }
}
