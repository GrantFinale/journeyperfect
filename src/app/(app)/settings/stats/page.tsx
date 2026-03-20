import { getTravelStats } from "@/lib/actions/travel-stats"
import { StatsView } from "./stats-view"

export default async function TravelStatsPage() {
  const stats = await getTravelStats()
  return <StatsView stats={stats} />
}
