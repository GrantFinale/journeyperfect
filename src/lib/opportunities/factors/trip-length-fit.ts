/**
 * Trip-length fit (stage 1, free). Plan §4.5: compares `nights` against the
 * profile's idealNightsMin/Max. Pure.
 *
 * Source is ESTIMATED: the ideal range is an editorial judgment in the
 * DestinationProfile, not a measurement.
 */
import type { FactorResult } from "../types"
import { reason, result } from "./shared"

export interface TripLengthFitInput {
  nights: number
  idealNightsMin: number
  idealNightsMax: number
  destinationName: string
}

export function evaluateTripLengthFit(input: TripLengthFitInput): FactorResult {
  const { nights, idealNightsMin, idealNightsMax, destinationName } = input
  const below = Math.max(0, idealNightsMin - nights)
  const above = Math.max(0, nights - idealNightsMax)
  const distance = below + above

  // Inside the range is a perfect fit; each night outside costs a quarter.
  const score = distance === 0 ? 1 : Math.max(0, 1 - 0.25 * distance)

  const facts = {
    nights,
    idealNightsMin,
    idealNightsMax,
    fit: distance === 0 ? "IDEAL" : below > 0 ? "SHORT" : "LONG",
    nightsOutsideIdeal: distance,
  }

  const reasons = []
  if (distance === 0) {
    reasons.push(reason("tripLengthFit", "POSITIVE", `Fits a ${nights}-night trip`, 0.3))
  } else if (below >= 2) {
    reasons.push(
      reason(
        "tripLengthFit",
        "NEGATIVE",
        `Short for ${destinationName}`,
        Math.min(1, 0.3 * below),
        `${nights} night${nights === 1 ? "" : "s"}; ${idealNightsMin}–${idealNightsMax} is typical`
      )
    )
  } else if (above >= 2) {
    reasons.push(
      reason(
        "tripLengthFit",
        "NEGATIVE",
        `Long for ${destinationName}`,
        Math.min(1, 0.2 * above),
        `${nights} nights; ${idealNightsMin}–${idealNightsMax} is typical`
      )
    )
  }

  return result("tripLengthFit", score, "ESTIMATED", facts, reasons)
}
