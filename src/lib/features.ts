import type { Plan } from "./plans"

export const PAID_FEATURES = {
  aiFlightParsing: { name: "AI Flight Parsing", minPlan: "PERSONAL" as Plan },
  aiItineraryOptimizer: { name: "AI Itinerary Optimizer", minPlan: "PERSONAL" as Plan },
  aiDiningRecommendations: { name: "AI Dining Recommendations", minPlan: "PERSONAL" as Plan },
  placesSearch: { name: "Activity Discovery", minPlan: "PERSONAL" as Plan },
  placesAutocomplete: { name: "Smart Destination Search", minPlan: "PERSONAL" as Plan },
  weatherAlerts: { name: "Weather Alerts & Rescheduling", minPlan: "PERSONAL" as Plan },
  tripSharing: { name: "Trip Sharing", minPlan: "PERSONAL" as Plan },
  liveFlightTracking: { name: "Live Flight Tracking", minPlan: "PERSONAL" as Plan },
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
