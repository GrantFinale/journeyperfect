import { notFound } from "next/navigation"
import { getBudgetSummary } from "@/lib/actions/budget"
import { getTrip } from "@/lib/actions/trips"
import { BudgetView } from "./budget-view"

export default async function BudgetPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, budget] = await Promise.all([getTrip(tripId), getBudgetSummary(tripId)])
    return <BudgetView tripId={tripId} initialBudget={budget} tripTitle={trip.title} />
  } catch {
    notFound()
  }
}
