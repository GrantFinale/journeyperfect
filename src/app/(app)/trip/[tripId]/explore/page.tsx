import { redirect } from "next/navigation"

export default async function ExplorePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  redirect(`/trip/${tripId}/discover`)
}
