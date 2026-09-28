import type { Plan } from "./plans"

export const PAID_FEATURES = {
  aiFlightParsing: { name: "AI Flight Parsing", minPlan: "PERSONAL" as Plan },
  // Ferry / train / bus booking parsing. Same plans as flight parsing so the
  // split off `aiFlightParsing` takes nothing away from existing subscribers.
  aiTransportParsing: { name: "AI Transport Parsing", minPlan: "PERSONAL" as Plan },
  aiItineraryOptimizer: { name: "AI Itinerary Optimizer", minPlan: "PERSONAL" as Plan },
  aiDiningRecommendations: { name: "AI Dining Recommendations", minPlan: "PERSONAL" as Plan },
  placesSearch: { name: "Activity Discovery", minPlan: "PERSONAL" as Plan },
  placesAutocomplete: { name: "Smart Destination Search", minPlan: "PERSONAL" as Plan },
  weatherAlerts: { name: "Weather Alerts & Rescheduling", minPlan: "PERSONAL" as Plan },
  tripSharing: { name: "Trip Sharing", minPlan: "PERSONAL" as Plan },
  liveFlightTracking: { name: "Live Flight Tracking", minPlan: "PERSONAL" as Plan },
  // Flights plan (docs/plans/flights-search-tracking-and-booking.md §4.5)
  flightSearch: { name: "Flight Search", minPlan: "PERSONAL" as Plan },
  flightPriceTracking: { name: "Flight Price Tracking", minPlan: "PERSONAL" as Plan },
  aiTripProposals: { name: "AI Trip Proposals", minPlan: "FAMILY" as Plan },
  // Opportunity Discovery Engine (docs/plans/opportunity-discovery-engine.md §8).
  // Private Rates are NOT a plan feature: they are gated by the
  // `privateRates.enabled` config key plus a per-user PrivateRateEntitlement.
  opportunityDiscovery: { name: "Opportunity Discovery", minPlan: "PERSONAL" as Plan },
  // MCP server / agent-writable access to the trip graph (flights plan §7)
  mcpAccess: { name: "Agent (MCP) Access", minPlan: "PERSONAL" as Plan },
} as const

const PLAN_ORDER: Plan[] = ["FREE", "PERSONAL", "FAMILY", "PRO"]

export function hasFeature(userPlan: Plan | string, feature: keyof typeof PAID_FEATURES): boolean {
  const planIndex = PLAN_ORDER.indexOf(userPlan as Plan)
  const requiredIndex = PLAN_ORDER.indexOf(PAID_FEATURES[feature].minPlan)
  return planIndex >= requiredIndex
}

export function getUpgradeMessage(feature: keyof typeof PAID_FEATURES): string {
  return `${PAID_FEATURES[feature].name} is available on ${PAID_FEATURES[feature].minPlan} plans and above. Upgrade to unlock this feature.`
}
