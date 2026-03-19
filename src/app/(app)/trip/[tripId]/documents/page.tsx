import { notFound } from "next/navigation"
import { getDocuments } from "@/lib/actions/documents"
import { getTrip } from "@/lib/actions/trips"
import { DocumentsView } from "./documents-view"

export default async function DocumentsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, documents] = await Promise.all([getTrip(tripId), getDocuments(tripId)])
    return <DocumentsView tripId={tripId} initialDocuments={documents} flights={trip.flights} hotels={trip.hotels} />
  } catch {
    notFound()
  }
}
