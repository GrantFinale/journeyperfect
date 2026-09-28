/**
 * Door-to-door (stage 1, free). Plan §4.4. Pure; everything is ESTIMATED.
 *
 *   fly = home→airport (departure-planner drive estimate)
 *       + airportArrivalBufferMins (UserPreferences)
 *       + flight minutes (NonstopRoute.typicalDurationMins or a real offer)
 *       + arrival buffer (35 min: deplane, bags, curb)
 *       + airport→center (DestinationProfile.airportToCenterKm at 40 km/h)
 *
 * A driving alternative is computed when the great-circle distance is under
 * `drivingAlternativeMaxKm`, so a 55-minute flight is compared honestly with
 * a four-hour drive once airport overhead is added.
 */
import { estimateTravelMins } from "@/lib/departure-planner"
import { haversineDistance } from "@/lib/haversine"
import type { FactorResult, OpportunityReason, OpportunityTransportation, TransportMode } from "../types"
import { formatMins, reason, result, unavailable } from "./shared"

export const ARRIVAL_BUFFER_MINS = 35
export const AIRPORT_TO_CENTER_KMH = 40
/** Great-circle → road distance. Interstates are not straight lines. */
export const ROAD_DISTANCE_FACTOR = 1.2

export interface DoorToDoorInput {
  homeLat: number | null | undefined
  homeLng: number | null | undefined
  /** Departure airport; null when no nonstop route was found */
  airport: { iata: string; lat: number; lng: number } | null
  /** Flight minutes (typical or from an offer); null when flying is not an option */
  flightMins: number | null
  airportArrivalBufferMins: number
  arrivalBufferMins?: number
  airportToCenterKm: number
  destinationLat: number
  destinationLng: number
  drivingAlternativeMaxKm: number
  /** User's ceiling; over it is a scoring penalty, not a prune */
  maxDoorToDoorMins?: number | null
}

export interface DoorToDoorEstimate {
  mode: TransportMode
  doorToDoorMins: number
  flyMins: number | null
  driveMins: number | null
  homeToAirportMins: number | null
  airportToCenterMins: number | null
  distanceKm: number
}

export function estimateDoorToDoor(input: DoorToDoorInput): DoorToDoorEstimate | null {
  if (input.homeLat == null || input.homeLng == null) return null
  const distanceKm = haversineDistance(input.homeLat, input.homeLng, input.destinationLat, input.destinationLng)

  let flyMins: number | null = null
  let homeToAirportMins: number | null = null
  let airportToCenterMins: number | null = null
  if (input.airport && input.flightMins != null && input.flightMins > 0) {
    const toAirportKm = haversineDistance(input.homeLat, input.homeLng, input.airport.lat, input.airport.lng) * ROAD_DISTANCE_FACTOR
    homeToAirportMins = estimateTravelMins(toAirportKm, "drive")
    airportToCenterMins = Math.ceil((Math.max(0, input.airportToCenterKm) / AIRPORT_TO_CENTER_KMH) * 60)
    flyMins =
      homeToAirportMins +
      Math.max(0, input.airportArrivalBufferMins) +
      Math.round(input.flightMins) +
      (input.arrivalBufferMins ?? ARRIVAL_BUFFER_MINS) +
      airportToCenterMins
  }

  const driveMins = distanceKm <= input.drivingAlternativeMaxKm ? estimateTravelMins(distanceKm * ROAD_DISTANCE_FACTOR, "drive") : null

  if (flyMins == null && driveMins == null) return null
  const mode: TransportMode = flyMins == null ? "DRIVE" : driveMins != null && driveMins < flyMins ? "DRIVE" : "FLY"
  return {
    mode,
    doorToDoorMins: mode === "FLY" ? flyMins! : driveMins!,
    flyMins,
    driveMins,
    homeToAirportMins,
    airportToCenterMins,
    distanceKm: Math.round(distanceKm),
  }
}

export function evaluateDoorToDoor(input: DoorToDoorInput): FactorResult {
  const est = estimateDoorToDoor(input)
  if (!est) return unavailable("doorToDoor")

  // 3h door to door is as good as it gets; 10h is a lost day.
  const score = 1 - Math.min(1, Math.max(0, (est.doorToDoorMins - 180) / 420))

  const reasons: OpportunityReason[] = []
  if (est.doorToDoorMins <= 240) {
    reasons.push(reason("doorToDoor", "POSITIVE", `Door to door ≈ ${formatMins(est.doorToDoorMins)}`, 0.35))
  } else if (est.doorToDoorMins >= 540) {
    reasons.push(reason("doorToDoor", "NEGATIVE", "Long travel day", 0.45, `≈ ${formatMins(est.doorToDoorMins)} door to door`))
  }
  if (input.maxDoorToDoorMins != null && est.doorToDoorMins > input.maxDoorToDoorMins) {
    reasons.push(
      reason("doorToDoor", "NEGATIVE", "Over your travel-time limit", 0.5, `≈ ${formatMins(est.doorToDoorMins)} vs ${formatMins(input.maxDoorToDoorMins)}`)
    )
  }
  if (est.mode === "FLY" && est.driveMins != null && est.flyMins != null && est.driveMins - est.flyMins <= 45) {
    reasons.push(
      reason("doorToDoor", "NEGATIVE", "Driving is about as fast", 0.2, `≈ ${formatMins(est.driveMins)} by car vs ${formatMins(est.flyMins)} flying, airport time included`)
    )
  }

  return result(
    "doorToDoor",
    score,
    "ESTIMATED",
    {
      mode: est.mode,
      doorToDoorMins: est.doorToDoorMins,
      flyMins: est.flyMins ?? "",
      driveMins: est.driveMins ?? "",
      homeToAirportMins: est.homeToAirportMins ?? "",
      airportToCenterMins: est.airportToCenterMins ?? "",
      flightMins: input.flightMins ?? "",
      distanceKm: est.distanceKm,
      departureAirport: input.airport?.iata ?? "",
      overCeiling: input.maxDoorToDoorMins != null && est.doorToDoorMins > input.maxDoorToDoorMins,
    },
    reasons
  )
}

/** Assemble the `transportation` Json from the door-to-door and airfare facts. */
export function transportationFromFacts(
  doorToDoor: FactorResult | undefined,
  airfare: FactorResult | undefined
): OpportunityTransportation {
  const mode: TransportMode = doorToDoor?.facts.mode === "DRIVE" ? "DRIVE" : "FLY"
  const flightMins = Number(airfare?.facts.durationMins) || Number(doorToDoor?.facts.flightMins) || 0
  const driveMins = Number(doorToDoor?.facts.driveMins) || 0
  const carriers = typeof airfare?.facts.carriers === "string" && airfare.facts.carriers ? airfare.facts.carriers.split(",") : []
  const out: OpportunityTransportation = {
    mode,
    durationMins: mode === "DRIVE" ? driveMins : flightMins,
    doorToDoorMins: Number(doorToDoor?.facts.doorToDoorMins) || (mode === "DRIVE" ? driveMins : flightMins),
    carriers,
    source: airfare?.available && airfare.source === "RETRIEVED" && mode === "FLY" ? "RETRIEVED" : "ESTIMATED",
  }
  if (typeof airfare?.facts.departs === "string" && airfare.facts.departs) out.departs = airfare.facts.departs
  if (typeof airfare?.facts.returns === "string" && airfare.facts.returns) out.returns = airfare.facts.returns
  return out
}
