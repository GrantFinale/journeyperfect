/**
 * Config-free constants for the two ESTIMATED addends of the core trip cost
 * (plan §4.6). These are deliberately coarse tiers, never presented as
 * retrieved prices: the UI labels them "est".
 *
 *   coreTripCost = airfareTotal + hotelTotal + groundTransportEstimate + majorActivityEstimate
 *
 * Food is shown separately and is not estimated here.
 */
import type { NormalisedProfile, ProfileAnchor } from "./destinations"
import type { FactorSource } from "./types"

/** Party sizes above this need a minivan or two rideshares. */
const LARGE_PARTY = 5

/**
 * Ground transport per trip, by how the destination is got around.
 * Rental figures are per day incl. taxes; rideshare is a per-day allowance.
 */
export const GROUND_TRANSPORT_TIERS = {
  walkable: { perDay: 20, label: "transit + occasional ride" },
  rideshare: { perDay: 60, label: "rideshares" },
  rideshareLargeParty: { perDay: 110, label: "two rideshares" },
  rentalCar: { perDay: 75, label: "rental car" },
  minivan: { perDay: 120, label: "minivan rental" },
} as const

export const PARKING_PER_DAY: Record<"FREE" | "CHEAP" | "EXPENSIVE", number> = {
  FREE: 0,
  CHEAP: 15,
  EXPENSIVE: 40,
}

/** Airport transfer both ways when the party is not renting a car. */
export const AIRPORT_TRANSFER_PER_KM = 2.2

export interface GroundTransportEstimate {
  total: number
  label: string
  source: FactorSource
}

export function estimateGroundTransport(
  profile: Pick<NormalisedProfile, "walkable" | "carNeeded" | "parkingTypical" | "activitiesDispersed" | "airportToCenterKm">,
  nights: number,
  partySize: number,
  mode: "FLY" | "DRIVE" = "FLY"
): GroundTransportEstimate {
  const days = Math.max(1, nights)
  const large = partySize > LARGE_PARTY

  if (mode === "DRIVE") {
    // Own car: fuel is a wash against the flight it replaces; count parking.
    const total = PARKING_PER_DAY[profile.parkingTypical] * days
    return { total: Math.round(total), label: "own car + parking", source: "ESTIMATED" }
  }

  let tier: (typeof GROUND_TRANSPORT_TIERS)[keyof typeof GROUND_TRANSPORT_TIERS]
  let parking = 0
  let transfer = 0
  if (profile.carNeeded) {
    tier = large ? GROUND_TRANSPORT_TIERS.minivan : GROUND_TRANSPORT_TIERS.rentalCar
    parking = PARKING_PER_DAY[profile.parkingTypical] * days
  } else if (profile.walkable && !profile.activitiesDispersed) {
    tier = GROUND_TRANSPORT_TIERS.walkable
    transfer = profile.airportToCenterKm * AIRPORT_TRANSFER_PER_KM * 2 * (large ? 2 : 1)
  } else {
    tier = large ? GROUND_TRANSPORT_TIERS.rideshareLargeParty : GROUND_TRANSPORT_TIERS.rideshare
    transfer = profile.airportToCenterKm * AIRPORT_TRANSFER_PER_KM * 2 * (large ? 2 : 1)
  }
  const total = tier.perDay * days + parking + transfer
  return { total: Math.round(total), label: tier.label, source: "ESTIMATED" }
}

/**
 * Per-person, per-trip allowance for the anchor experience by kind. Uses the
 * seed's raw kind when present (THEME_PARK is the expensive one), then the
 * plan's AnchorKind.
 */
export const MAJOR_ACTIVITY_PER_PERSON: Record<string, number> = {
  THEME_PARK: 150, // one park day per person
  SPORTS: 90,
  EVENT: 80,
  CONCERT: 90,
  FESTIVAL: 50,
  ATTRACTION: 40,
  NATURE: 15,
  NATURAL: 15,
  SEASONAL: 25,
  OTHER: 40,
}

/** Children under this age are usually free or heavily discounted. */
const FREE_UNDER_AGE = 3

export function estimateMajorActivity(
  anchor: Pick<ProfileAnchor, "kind" | "rawKind"> | { kind: string; rawKind?: string } | null,
  ages: readonly number[],
  nights: number
): { total: number; source: FactorSource } {
  if (!anchor) return { total: 0, source: "ESTIMATED" }
  const perPerson = MAJOR_ACTIVITY_PER_PERSON[anchor.rawKind ?? ""] ?? MAJOR_ACTIVITY_PER_PERSON[anchor.kind] ?? MAJOR_ACTIVITY_PER_PERSON.OTHER
  const paying = ages.filter((a) => a >= FREE_UNDER_AGE).length || 1
  // Longer trips tend to add a second big day; cap at two.
  const bigDays = nights >= 5 ? 2 : 1
  return { total: Math.round(perPerson * paying * bigDays), source: "ESTIMATED" }
}

const SOURCE_RANK: Record<FactorSource, number> = { RETRIEVED: 0, HISTORICAL: 1, ESTIMATED: 2, UNKNOWN: 3 }

/** The total is labelled by its weakest addend (plan §4.6). */
export function weakestSource(sources: readonly FactorSource[]): FactorSource {
  let worst: FactorSource = "RETRIEVED"
  for (const s of sources) if (SOURCE_RANK[s] > SOURCE_RANK[worst]) worst = s
  return worst
}

export interface CoreTripCostInput {
  airfareTotal: number | null
  airfareSource: FactorSource
  hotelTotal: number | null
  hotelSource: FactorSource
  groundTransportEstimate: number
  majorActivityEstimate: number
}

export function assembleCoreTripCost(input: CoreTripCostInput): { total: number | null; source: FactorSource } {
  const sources: FactorSource[] = ["ESTIMATED", "ESTIMATED"] // ground + activity are always estimates
  let total = input.groundTransportEstimate + input.majorActivityEstimate
  if (input.airfareTotal != null) {
    total += input.airfareTotal
    sources.push(input.airfareSource)
  } else {
    sources.push("UNKNOWN")
  }
  if (input.hotelTotal != null) {
    total += input.hotelTotal
    sources.push(input.hotelSource)
  } else {
    sources.push("UNKNOWN")
  }
  const source = weakestSource(sources)
  // With no airfare and no hotel there is no meaningful total to show.
  if (input.airfareTotal == null && input.hotelTotal == null) return { total: null, source: "UNKNOWN" }
  return { total: Math.round(total), source }
}

function finiteNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * Private (Go) hotel cost for the core estimate from hotelValue facts:
 * nightly × nights, else the quoted private total. Null when neither exists;
 * never derived from a public rate.
 */
export function hotelStayTotal(facts: Record<string, unknown>, nights: number): number | null {
  const nightly = finiteNum(facts.privateNightlyRate)
  if (nightly != null && nightly > 0) return Math.round(nightly * Math.max(1, nights) * 100) / 100
  const total = finiteNum(facts.privateTotal)
  return total != null && total > 0 ? total : null
}
