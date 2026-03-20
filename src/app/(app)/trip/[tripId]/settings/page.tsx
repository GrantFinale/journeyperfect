import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getTrip } from "@/lib/actions/trips"
import { getTravelerProfiles } from "@/lib/actions/travelers"
import { getCollaborators } from "@/lib/actions/collaborators"
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
    const session = await auth()
    const [trip, allProfiles, collaborators] = await Promise.all([
      getTrip(tripId),
      getTravelerProfiles(),
      getCollaborators(tripId),
    ])

    // Get owner info
    const owner = await prisma.user.findUnique({
      where: { id: trip.userId },
      select: { name: true, email: true },
    })

    const isOwner = session?.user?.id === trip.userId
    const placesApiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || ""

    return (
      <TripSettingsView
        tripId={tripId}
        trip={trip}
        allProfiles={allProfiles}
        initialTab={tab}
        isOwner={isOwner}
        ownerName={owner?.name}
        ownerEmail={owner?.email}
        initialCollaborators={collaborators}
        placesApiKey={placesApiKey}
      />
    )
  } catch {
    notFound()
  }
}
