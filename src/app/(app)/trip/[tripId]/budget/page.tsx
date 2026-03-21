import { notFound } from "next/navigation"
import { getBudgetSummary } from "@/lib/actions/budget"
import { getTrip } from "@/lib/actions/trips"
import { getTripCostSummary } from "@/lib/actions/costs"
import { getExpenseSummary, getTripPeople } from "@/lib/actions/expenses"
import { BudgetView } from "./budget-view"

export default async function BudgetPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  try {
    const [trip, budget, costSummary, expenseSummary, people] = await Promise.all([
      getTrip(tripId),
      getBudgetSummary(tripId),
      getTripCostSummary(tripId),
      getExpenseSummary(tripId),
      getTripPeople(tripId),
    ])
    return (
      <BudgetView
        tripId={tripId}
        initialBudget={budget}
        tripTitle={trip.title}
        costSummary={costSummary}
        settlements={expenseSummary.settlements}
        balances={expenseSummary.balances}
        people={people}
      />
    )
  } catch {
    notFound()
  }
}
