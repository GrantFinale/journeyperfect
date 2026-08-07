import { haversineDistance } from "./haversine"

/**
 * Default "be there this many minutes before departure" buffers, by leg type.
 * A booking's own `checkInMinsBefore` always wins over these.
 */
export const DEFAULT_CHECKIN_BUFFER_MINS = {
  FLIGHT: 90,
  FERRY: 45,
  FERRY_WITH_VEHICLE: 60,
  TRAIN: 30,
  BUS: 20,
  RENTAL_CAR_PICKUP: 15,
} as const

export type CheckInBufferKey = keyof typeof DEFAULT_CHECKIN_BUFFER_MINS

export type TravelMode = "walk" | "drive" | "rideshare" | "transit"

// Speed constants shared with <TravelConnector /> — keep these in one place.
export const WALKING_SPEED_KMH = 5
/** Door-to-door city driving: lights, parking, one-way streets. */
export const DRIVING_SPEED_KMH = 30
/** Sustained highway speed once you're out of town, averaged over ramps and tolls. */
export const HIGHWAY_SPEED_KMH = 85
/** Distance covered at city speed before a drive is mostly highway. */
export const URBAN_LEG_KM = 15
export const TRANSIT_SPEED_KMH = 20
export const MAX_WALK_MINS = 20

/** Longest distance we're willing to call "walkable" (MAX_WALK_MINS at walking speed). */
const MAX_WALK_KM = (MAX_WALK_MINS / 60) * WALKING_SPEED_KMH
/** Short hops that are too far to walk but not worth getting your own car out for. */
const MAX_RIDESHARE_KM = 5
/** Typical wait between hailing a ride and being picked up. */
const RIDESHARE_PICKUP_MINS = 5

export function pickTravelMode(distanceKm: number): TravelMode {
  if (distanceKm <= MAX_WALK_KM) return "walk"
  if (distanceKm <= MAX_RIDESHARE_KM) return "rideshare"
  return "drive"
}

export function estimateTravelMins(distanceKm: number, mode: TravelMode): number {
  let mins: number
  if (mode === "walk") {
    mins = Math.ceil((distanceKm / WALKING_SPEED_KMH) * 60)
  } else if (mode === "transit") {
    mins = Math.ceil((distanceKm / TRANSIT_SPEED_KMH) * 60)
  } else {
    // A flat city speed turns a 70 km run up the interstate into a 2.5 hour drive.
    // Charge the first URBAN_LEG_KM at city speed, the rest at highway speed.
    const urbanKm = Math.min(distanceKm, URBAN_LEG_KM)
    const highwayKm = Math.max(distanceKm - URBAN_LEG_KM, 0)
    mins = Math.ceil(((urbanKm / DRIVING_SPEED_KMH) + (highwayKm / HIGHWAY_SPEED_KMH)) * 60)
  }
  const withWait = mode === "rideshare" ? mins + RIDESHARE_PICKUP_MINS : mins
  return Math.max(withWait, 1)
}

export function formatTravelMode(mode: TravelMode): string {
  return mode === "walk" ? "walk" : mode === "rideshare" ? "ride" : mode === "transit" ? "transit" : "drive"
}

export function travelModeIcon(mode: TravelMode): string {
  return mode === "walk" ? "🚶" : mode === "transit" ? "🚌" : "🚗"
}

export function formatDurationMins(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export interface LeaveByPlan {
  leaveBy: Date
  arriveBy: Date
  travelMins: number
  travelMode: TravelMode
  distanceKm: number
  /** The check-in buffer actually applied, in minutes. */
  checkInMins: number
}

/**
 * Work backwards from a departure time to the moment you have to walk out the door.
 *
 *   arriveBy = departAt − checkInBuffer
 *   leaveBy  = arriveBy − travelMins
 *
 * Returns null when either endpoint has no coordinates — we never guess a distance.
 */
export function computeLeaveBy(opts: {
  departAt: Date
  checkInMinsBefore?: number | null
  modeDefault: CheckInBufferKey
  originLat?: number | null
  originLng?: number | null
  destLat?: number | null
  destLng?: number | null
}): LeaveByPlan | null {
  const { departAt, checkInMinsBefore, modeDefault, originLat, originLng, destLat, destLng } = opts

  if (originLat == null || originLng == null || destLat == null || destLng == null) return null
  if (!(departAt instanceof Date) || Number.isNaN(departAt.getTime())) return null

  const checkInMins =
    checkInMinsBefore != null && checkInMinsBefore >= 0
      ? checkInMinsBefore
      : DEFAULT_CHECKIN_BUFFER_MINS[modeDefault]

  const distanceKm = haversineDistance(originLat, originLng, destLat, destLng)
  const travelMode = pickTravelMode(distanceKm)
  const travelMins = estimateTravelMins(distanceKm, travelMode)

  const arriveBy = new Date(departAt.getTime() - checkInMins * 60_000)
  const leaveBy = new Date(arriveBy.getTime() - travelMins * 60_000)

  return { leaveBy, arriveBy, travelMins, travelMode, distanceKm, checkInMins }
}

/** Pick the right default buffer for a transport segment. */
export function bufferKeyForTransport(
  mode: "FERRY" | "TRAIN" | "BUS",
  vehicleOnBoard?: boolean | null
): CheckInBufferKey {
  if (mode === "FERRY") return vehicleOnBoard ? "FERRY_WITH_VEHICLE" : "FERRY"
  return mode
}
