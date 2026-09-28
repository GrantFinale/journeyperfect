import { getConfig } from "./config"

export const PLANS = {
  // maxFlightWatches: tracked FlightSearch rows (isTracking) per user. Watches
  // carry recurring provider cost, so this is the primary spend control.
  // maxOpportunitySearchesPerDay: OpportunitySearch runs per user per UTC day.
  FREE: { name: "Free", maxTrips: 2, maxTravelersPerTrip: 2, canShare: false, maxFlightWatches: 0, maxOpportunitySearchesPerDay: 0 },
  PERSONAL: { name: "Personal", maxTrips: 10, maxTravelersPerTrip: 6, canShare: true, maxFlightWatches: 3, maxOpportunitySearchesPerDay: 3 },
  FAMILY: { name: "Family", maxTrips: 25, maxTravelersPerTrip: 10, canShare: true, maxFlightWatches: 10, maxOpportunitySearchesPerDay: 5 },
  PRO: { name: "Pro", maxTrips: 999, maxTravelersPerTrip: 999, canShare: true, maxFlightWatches: 50, maxOpportunitySearchesPerDay: 20 },
} as const

export type Plan = keyof typeof PLANS

export function getPlanLimits(plan: Plan) {
  return PLANS[plan]
}

/**
 * Plan limits with per-plan overrides from AppConfig, e.g.
 * `plans.PERSONAL.maxFlightWatches = "5"`. Every limit is tunable from
 * /admin/settings without a deploy.
 */
export async function getDynamicPlanLimits(plan: Plan) {
  const defaults = PLANS[plan]
  const maxTrips = parseInt(await getConfig(`plans.${plan}.maxTrips`, String(defaults.maxTrips)))
  const maxTravelersPerTrip = parseInt(await getConfig(`plans.${plan}.maxTravelersPerTrip`, String(defaults.maxTravelersPerTrip)))
  const canShare = (await getConfig(`plans.${plan}.canShare`, String(defaults.canShare))) === "true"
  const maxFlightWatches = parseInt(await getConfig(`plans.${plan}.maxFlightWatches`, String(defaults.maxFlightWatches)))
  const maxOpportunitySearchesPerDay = parseInt(
    await getConfig(`plans.${plan}.maxOpportunitySearchesPerDay`, String(defaults.maxOpportunitySearchesPerDay))
  )
  return { ...defaults, maxTrips, maxTravelersPerTrip, canShare, maxFlightWatches, maxOpportunitySearchesPerDay }
}

// Price IDs (from env)
export const STRIPE_PRICE_IDS = {
  PERSONAL: process.env.STRIPE_PRICE_PERSONAL_ID!,
  FAMILY: process.env.STRIPE_PRICE_FAMILY_ID!,
  PRO: process.env.STRIPE_PRICE_PRO_ID!,
}
