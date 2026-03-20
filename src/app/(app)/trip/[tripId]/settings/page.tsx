import { notFound } from "next/navigation"
import { getTrip } from "@/lib/actions/trips"
import { getTravelerProfiles } from "@/lib/actions/travelers"
import { TripSettingsView } from "./trip-settings-view"

export default async function TripSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { tripId } = await params
  const { tab } = await searchParams

  try {
    const [trip, allProfiles] = await Promise.all([getTrip(tripId), getTravelerProfiles()])
    return (
      <TripSettingsView
        tripId={tripId}
        trip={trip}
        allProfiles={allProfiles}
        initialTab={tab}
      />
    )
  } catch {
    notFound()
  }
}
