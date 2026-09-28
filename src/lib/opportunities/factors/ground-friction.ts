/**
 * Ground friction (stage 1, free). Plan §4.4: walkable, car needed, parking,
 * dispersed activities, plus the six-person penalty (two rideshares or a
 * minivan). Pure; ESTIMATED.
 */
import type { ParkingTypical } from "../types"
import type { FactorResult, OpportunityReason } from "../types"
import { reason, result } from "./shared"

export interface GroundFrictionInput {
  walkable: boolean
  carNeeded: boolean
  parkingTypical: ParkingTypical
  activitiesDispersed: boolean
  partySize: number
}

/** Parties larger than this do not fit one rideshare or a standard rental. */
export const LARGE_PARTY = 5

export function evaluateGroundFriction(input: GroundFrictionInput): FactorResult {
  let score = 1
  if (input.carNeeded) score -= 0.35
  if (!input.walkable) score -= 0.15
  if (input.activitiesDispersed) score -= 0.15
  if (input.parkingTypical === "EXPENSIVE") score -= 0.1
  else if (input.parkingTypical === "CHEAP") score -= 0.05
  const largeParty = input.partySize > LARGE_PARTY
  const sixPersonPenalty = input.carNeeded && largeParty
  if (sixPersonPenalty) score -= 0.15

  const reasons: OpportunityReason[] = []
  if (input.carNeeded) {
    reasons.push(
      reason(
        "groundFriction",
        "NEGATIVE",
        sixPersonPenalty ? `Car needed; ${input.partySize} seats means a minivan` : "Car needed",
        sixPersonPenalty ? 0.45 : 0.3,
        input.parkingTypical === "EXPENSIVE" ? "Parking is expensive" : undefined
      )
    )
  } else if (input.walkable && !input.activitiesDispersed) {
    reasons.push(reason("groundFriction", "POSITIVE", "Walkable, no car needed", 0.3))
  } else if (largeParty && input.activitiesDispersed) {
    reasons.push(reason("groundFriction", "NEGATIVE", `Spread out; ${input.partySize} people means two rideshares`, 0.25))
  }

  return result(
    "groundFriction",
    score,
    "ESTIMATED",
    {
      walkable: input.walkable,
      carNeeded: input.carNeeded,
      parkingTypical: input.parkingTypical,
      activitiesDispersed: input.activitiesDispersed,
      partySize: input.partySize,
      largePartyPenalty: sixPersonPenalty,
    },
    reasons
  )
}
