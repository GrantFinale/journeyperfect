export const PLANS = {
  FREE: { name: "Free", maxTrips: 2, maxTravelersPerTrip: 2, canShare: false },
  PERSONAL: { name: "Personal", maxTrips: 10, maxTravelersPerTrip: 6, canShare: true },
  FAMILY: { name: "Family", maxTrips: 25, maxTravelersPerTrip: 10, canShare: true },
  PRO: { name: "Pro", maxTrips: 999, maxTravelersPerTrip: 999, canShare: true },
} as const

export type Plan = keyof typeof PLANS

export function getPlanLimits(plan: Plan) {
  return PLANS[plan]
}

// Price IDs (from env)
export const STRIPE_PRICE_IDS = {
  PERSONAL: process.env.STRIPE_PRICE_PERSONAL_ID!,
  FAMILY: process.env.STRIPE_PRICE_FAMILY_ID!,
  PRO: process.env.STRIPE_PRICE_PRO_ID!,
}
