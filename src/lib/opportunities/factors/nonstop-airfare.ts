/**
 * Nonstop access and airfare (stage 2, cheap paid). Plan §4.2. Pure.
 *
 * Returns two FactorResults: `nonstop` (is there useful nonstop service, how
 * often, at what hours) and `airfare` (party total for the best offer, with
 * outlier detection against two baselines: the median across this
 * destination's other date candidates in the same search, and the route's own
 * price history where it exists). A fare 35% under either baseline is a
 * reason; under both is a headline.
 *
 * Airfare is always the party total. Providers price the whole party, so
 * `totalPrice` is used as-is; `perTraveler` is recorded for display only. We
 * never add fees we did not retrieve.
 */
import type { FlightOfferResult } from "@/lib/flights/types"
import type { NonstopRouteRow } from "../destinations"
import { airfareHeadline, airfareUnderDetail } from "../reason-text"
import type { FactorResult, OpportunityReason } from "../types"
import { formatMins, joinNames, median, reason, result, round, unavailable } from "./shared"

export const AIRFARE_OUTLIER_RATIO = 0.35

/** Carrier code -> display name for the few carriers that dominate US leisure routes. */
export const CARRIER_NAMES: Record<string, string> = {
  AA: "American",
  AS: "Alaska",
  B6: "JetBlue",
  DL: "Delta",
  F9: "Frontier",
  G4: "Allegiant",
  HA: "Hawaiian",
  NK: "Spirit",
  SY: "Sun Country",
  UA: "United",
  WN: "Southwest",
  MX: "Breeze",
  AC: "Air Canada",
  WS: "WestJet",
  AM: "Aeromexico",
  Y4: "Volaris",
}

export function carrierName(code: string): string {
  return CARRIER_NAMES[code.toUpperCase()] ?? code.toUpperCase()
}

export type OfferWithId = FlightOfferResult & { id?: string }

export interface NonstopAirfareInput {
  offers: OfferWithId[]
  route: NonstopRouteRow | null
  travelerCount: number
  nonstopOnly?: boolean
  /** Party totals of the best offer for this destination's OTHER date candidates */
  otherDateTotals?: number[]
  /** Recent FlightPricePoint prices for this route (party totals) */
  routeHistory?: number[]
  /** ISO 8601 */
  retrievedAt?: string
  originIata?: string
  destinationIata?: string
}

export interface NonstopAirfareResult {
  nonstop: FactorResult
  airfare: FactorResult
  best: OfferWithId | null
}

export function pickBestOffer(offers: readonly OfferWithId[]): OfferWithId | null {
  if (offers.length === 0) return null
  const nonstop = offers.filter((o) => o.stops === 0)
  const pool = nonstop.length ? nonstop : offers
  return pool.reduce((best, o) => (o.totalPrice < best.totalPrice ? o : best))
}

function frequencyScore(weekly: number | null | undefined): number {
  if (weekly == null) return 0.1 // unknown: neither reward nor punish much
  if (weekly >= 21) return 0.25
  if (weekly >= 14) return 0.2
  if (weekly >= 7) return 0.15
  if (weekly >= 3) return 0.05
  return -0.1
}

function bucketScore(buckets: readonly string[] | undefined): number {
  if (!buckets || buckets.length === 0) return 0
  const useful = buckets.filter((b) => b === "MORNING" || b === "MIDDAY").length
  const onlyEarly = buckets.every((b) => b === "EARLY")
  if (onlyEarly) return -0.1
  return useful > 0 ? 0.1 : 0
}

export function evaluateNonstopAirfare(input: NonstopAirfareInput): NonstopAirfareResult {
  const { offers, route, travelerCount } = input
  const best = pickBestOffer(offers)
  const nonstopOffers = offers.filter((o) => o.stops === 0)
  const nonstopFound = nonstopOffers.length > 0

  // ── nonstop ─────────────────────────────────────────────────────────────
  let nonstop: FactorResult
  if (!best && !route) {
    nonstop = unavailable("nonstop")
  } else {
    const carriers = nonstopFound
      ? [...new Set(nonstopOffers.flatMap((o) => o.carrierCodes))]
      : route?.carriers ?? []
    const durationMins = nonstopFound ? Math.min(...nonstopOffers.map((o) => o.outbound.durationMins)) : route?.typicalDurationMins ?? 0
    let score: number
    let source: FactorResult["source"]
    const reasons: OpportunityReason[] = []
    const routeText = input.originIata && input.destinationIata ? `${input.originIata}→${input.destinationIata} ` : ""

    if (nonstopFound) {
      source = "RETRIEVED"
      score = 0.7 + frequencyScore(route?.weeklyFrequency) + bucketScore(route?.departureBuckets)
      const bothWays = nonstopOffers.some((o) => !o.inbound || o.inbound.stops === 0)
      reasons.push(
        reason(
          "nonstop",
          "POSITIVE",
          bothWays ? "Nonstop both ways" : "Nonstop outbound",
          0.5,
          `${routeText}${formatMins(durationMins)}, ${joinNames(carriers.map(carrierName))} option${carriers.length === 1 ? "" : "s"}`
        )
      )
      if (route?.weeklyFrequency != null && route.weeklyFrequency <= 2) {
        reasons.push(reason("nonstop", "NEGATIVE", `Only ${route.weeklyFrequency === 1 ? "one" : "two"} nonstop${route.weeklyFrequency === 1 ? "" : "s"} a week`, 0.35))
      }
    } else if (best) {
      // Offers came back but none nonstop.
      source = "RETRIEVED"
      score = route ? 0.3 : 0.15
      reasons.push(
        reason("nonstop", "NEGATIVE", "No nonstop found for these dates", input.nonstopOnly ? 0.8 : 0.4, `Best option has ${best.stops} stop${best.stops === 1 ? "" : "s"}`)
      )
    } else {
      // No offers yet (stage 1 view): route knowledge only.
      source = "ESTIMATED"
      score = 0.5 + frequencyScore(route?.weeklyFrequency) + bucketScore(route?.departureBuckets)
    }

    nonstop = result(
      "nonstop",
      score,
      source,
      {
        nonstopFound,
        nonstopKnown: route != null,
        carriers: carriers.join(","),
        durationMins,
        weeklyFrequency: route?.weeklyFrequency ?? "",
        departureBuckets: (route?.departureBuckets ?? []).join(","),
        routeSource: route?.source ?? "",
        offerCount: offers.length,
        nonstopOfferCount: nonstopOffers.length,
      },
      reasons,
      source === "RETRIEVED" ? input.retrievedAt : undefined
    )
  }

  // ── airfare ─────────────────────────────────────────────────────────────
  let airfare: FactorResult
  if (!best) {
    airfare = unavailable("airfare", { offerCount: 0 })
  } else {
    const partyTotal = round(best.totalPrice, 2)
    const perTraveler = round(partyTotal / Math.max(1, travelerCount), 2)
    const medianOther = median(input.otherDateTotals ?? [])
    const medianHistory = median(input.routeHistory ?? [])
    const underOther = medianOther != null && medianOther > 0 ? 1 - partyTotal / medianOther : null
    const underHistory = medianHistory != null && medianHistory > 0 ? 1 - partyTotal / medianHistory : null
    const outlierOther = underOther != null && underOther >= AIRFARE_OUTLIER_RATIO
    const outlierHistory = underHistory != null && underHistory >= AIRFARE_OUTLIER_RATIO

    let score = 0.5
    const bestUnder = Math.max(underOther ?? -Infinity, underHistory ?? -Infinity)
    if (Number.isFinite(bestUnder)) {
      if (bestUnder >= AIRFARE_OUTLIER_RATIO) score = outlierOther && outlierHistory ? 0.95 : 0.85
      else if (bestUnder >= 0.2) score = 0.7
      else if (bestUnder >= 0) score = 0.55
      else if (bestUnder >= -0.2) score = 0.4
      else score = 0.25
    }

    const reasons: OpportunityReason[] = []
    if (outlierOther || outlierHistory) {
      const which = outlierOther && outlierHistory ? "both" : outlierOther ? "other dates" : "route history"
      const ratio = which === "both" ? Math.min(underOther!, underHistory!) : which === "other dates" ? underOther! : underHistory!
      reasons.push(
        reason(
          "airfare",
          "POSITIVE",
          airfareHeadline(partyTotal, travelerCount, best.currency),
          (which === "both" ? 0.6 : 0.4) + ratio,
          airfareUnderDetail(ratio, which)
        )
      )
    }

    const departs = best.outbound.segments[0]?.departAt ?? ""
    const returns = best.inbound?.segments[0]?.departAt ?? ""
    airfare = result(
      "airfare",
      score,
      "RETRIEVED",
      {
        partyTotal,
        perTraveler,
        travelerCount,
        currency: best.currency,
        stops: best.stops,
        durationMins: best.outbound.durationMins,
        carriers: best.carrierCodes.join(","),
        departs,
        returns,
        offerId: best.id ?? "",
        provider: best.provider,
        medianOtherDates: medianOther ?? "",
        medianRouteHistory: medianHistory ?? "",
        underOtherDates: underOther == null ? "" : round(underOther, 3),
        underRouteHistory: underHistory == null ? "" : round(underHistory, 3),
        offerCount: offers.length,
      },
      reasons,
      input.retrievedAt
    )
  }

  return { nonstop, airfare, best }
}
