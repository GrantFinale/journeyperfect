/**
 * Stage 0: the candidate destination set. See
 * docs/plans/opportunity-discovery-engine.md §3 (STAGE 0) and §4.5.
 *
 * Pure. Takes NonstopRoute rows for the origin airports and DestinationProfile
 * rows (DB rows or the JSON seed, normalised through `normaliseProfile`),
 * applies the user's constraints, caps the set and orders it deterministically
 * with a light diversity rule so a Detroit search is not twelve Florida
 * airports.
 *
 * DB access lives in pipeline.ts (`loadDestinationProfiles`,
 * `loadNonstopRoutes`), which falls back to the JSON seed files when the
 * tables are empty.
 */
import { haversineDistance } from "@/lib/haversine"
import { daysInMonth } from "./dates"
import type {
  AnchorKind,
  ClimateMonth,
  DestinationTier,
  ParkingTypical,
  SearchConstraints,
} from "./types"

// ─── Normalised profile ──────────────────────────────────────────────────────

/**
 * The seed's `byAgeBand` is a 0..3 rating per band; the plan's type sketch is
 * a tag list per band. Both are accepted and both are useful, so the
 * normalised shape keeps whichever it was given.
 */
export type AgeBandFit = number | string[]

export interface NormalisedFamilyFit {
  tags: string[]
  byAgeBand: Record<string, AgeBandFit>
  indoorRatio: number
}

/**
 * Seed anchors use richer kinds (THEME_PARK, NATURE, ATTRACTION) than the
 * plan's AnchorKind. `kind` is the plan enum; `rawKind` keeps the seed value
 * for the activity-cost table.
 */
export interface ProfileAnchor {
  title: string
  kind: AnchorKind
  rawKind: string
  months: number[]
  weatherDependent: boolean
}

export interface NormalisedProfile {
  iata: string
  name: string
  lat: number
  lng: number
  tier: DestinationTier
  idealNightsMin: number
  idealNightsMax: number
  walkable: boolean
  carNeeded: boolean
  airportToCenterKm: number
  parkingTypical: ParkingTypical
  activitiesDispersed: boolean
  familyFit: NormalisedFamilyFit
  anchors: ProfileAnchor[]
  /** Always 12 entries when present */
  climate: ClimateMonth[] | null
  generatedBy: string
}

export interface NonstopRouteRow {
  originIata: string
  destIata: string
  carriers: string[]
  weeklyFrequency?: number | null
  typicalDurationMins: number
  departureBuckets?: string[]
  source?: string
  lastVerifiedAt?: Date | string | null
}

const ANCHOR_KIND_MAP: Record<string, AnchorKind> = {
  SEASONAL: "SEASONAL",
  EVENT: "EVENT",
  NATURAL: "NATURAL",
  NATURE: "NATURAL",
  FESTIVAL: "FESTIVAL",
  SPORTS: "SPORTS",
  THEME_PARK: "OTHER",
  ATTRACTION: "OTHER",
  OTHER: "OTHER",
}

const TIERS: readonly DestinationTier[] = ["BUDGET", "MID", "UPSCALE", "LUXURY"]
const PARKING: readonly ParkingTypical[] = ["FREE", "CHEAP", "EXPENSIVE"]

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function normaliseAnchors(raw: unknown): ProfileAnchor[] {
  if (!Array.isArray(raw)) return []
  const out: ProfileAnchor[] = []
  for (const a of raw) {
    const r = asRecord(a)
    const title = typeof r.title === "string" ? r.title : null
    if (!title) continue
    const rawKind = typeof r.kind === "string" ? r.kind.toUpperCase() : "OTHER"
    const months = Array.isArray(r.months)
      ? r.months.map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
      : []
    out.push({
      title,
      kind: ANCHOR_KIND_MAP[rawKind] ?? "OTHER",
      rawKind,
      months: months.length ? months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      weatherDependent: r.weatherDependent === true,
    })
  }
  return out
}

/**
 * Accepts either the plan shape (`ClimateMonth[]` with precipPct) or the seed
 * shape (`{ monthly: [{ m, highF, lowF, precipDays }] }`).
 */
export function normaliseClimate(raw: unknown): ClimateMonth[] | null {
  const list = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw).monthly) ? (asRecord(raw).monthly as unknown[]) : null
  if (!list) return null
  const byMonth = new Map<number, ClimateMonth>()
  for (const item of list) {
    const r = asRecord(item)
    const month = Number(r.month ?? r.m)
    const highF = Number(r.highF)
    const lowF = Number(r.lowF)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(highF) || !Number.isFinite(lowF)) continue
    let precipPct: number
    if (Number.isFinite(Number(r.precipPct))) precipPct = Number(r.precipPct)
    else if (Number.isFinite(Number(r.precipDays))) precipPct = Math.round((Number(r.precipDays) / daysInMonth(month)) * 100)
    else precipPct = 0
    byMonth.set(month, { month, highF, lowF, precipPct: Math.max(0, Math.min(100, precipPct)) })
  }
  if (byMonth.size === 0) return null
  return [...byMonth.values()].sort((a, b) => a.month - b.month)
}

function normaliseFamilyFit(raw: unknown): NormalisedFamilyFit {
  const r = asRecord(raw)
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : []
  const byAgeBand: Record<string, AgeBandFit> = {}
  for (const [band, v] of Object.entries(asRecord(r.byAgeBand))) {
    if (typeof v === "number" && Number.isFinite(v)) byAgeBand[band] = v
    else if (Array.isArray(v)) byAgeBand[band] = v.filter((t): t is string => typeof t === "string")
  }
  const indoorRatio = Number(r.indoorRatio)
  return { tags, byAgeBand, indoorRatio: Number.isFinite(indoorRatio) ? Math.max(0, Math.min(1, indoorRatio)) : 0.5 }
}

/**
 * Normalise a DestinationProfile row or a seed object. Returns null when the
 * record lacks the fields stage 0 cannot do without (iata, name, coordinates).
 */
export function normaliseProfile(raw: unknown): NormalisedProfile | null {
  const r = asRecord(raw)
  const iata = typeof r.iata === "string" ? r.iata.trim().toUpperCase() : ""
  const name = typeof r.name === "string" ? r.name : ""
  const lat = Number(r.lat)
  const lng = Number(r.lng)
  if (iata.length !== 3 || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const tierRaw = typeof r.tier === "string" ? (r.tier.toUpperCase() as DestinationTier) : "MID"
  const parkingRaw = typeof r.parkingTypical === "string" ? (r.parkingTypical.toUpperCase() as ParkingTypical) : "CHEAP"
  const idealMin = Number(r.idealNightsMin)
  const idealMax = Number(r.idealNightsMax)

  return {
    iata,
    name,
    lat,
    lng,
    tier: TIERS.includes(tierRaw) ? tierRaw : "MID",
    idealNightsMin: Number.isFinite(idealMin) && idealMin > 0 ? idealMin : 2,
    idealNightsMax: Number.isFinite(idealMax) && idealMax >= idealMin ? idealMax : Math.max(idealMin || 2, 5),
    walkable: r.walkable === true,
    carNeeded: r.carNeeded === true,
    airportToCenterKm: Number.isFinite(Number(r.airportToCenterKm)) ? Number(r.airportToCenterKm) : 20,
    parkingTypical: PARKING.includes(parkingRaw) ? parkingRaw : "CHEAP",
    activitiesDispersed: r.activitiesDispersed === true,
    familyFit: normaliseFamilyFit(r.familyFit),
    anchors: normaliseAnchors(r.anchors),
    climate: normaliseClimate(r.climate),
    generatedBy: typeof r.generatedBy === "string" ? r.generatedBy : "UNKNOWN",
  }
}

// ─── Regions ─────────────────────────────────────────────────────────────────

/**
 * Free-form region tags for `SearchConstraints.regions` and the diversity
 * rule. Editorial, covers the seed profiles; unknown airports get "other".
 */
export const REGION_BY_IATA: Record<string, string[]> = {
  MCO: ["florida", "southeast", "us"],
  MIA: ["florida", "southeast", "us"],
  FLL: ["florida", "southeast", "us"],
  TPA: ["florida", "southeast", "us"],
  RSW: ["florida", "southeast", "us"],
  PBI: ["florida", "southeast", "us"],
  SRQ: ["florida", "southeast", "us"],
  JAX: ["florida", "southeast", "us"],
  MYR: ["southeast", "carolinas", "us"],
  CHS: ["southeast", "carolinas", "us"],
  SAV: ["southeast", "us"],
  ATL: ["southeast", "us"],
  BNA: ["southeast", "us"],
  MSY: ["gulf-coast", "south", "us"],
  AUS: ["texas", "south", "us"],
  SAT: ["texas", "south", "us"],
  SAN: ["california", "west-coast", "us"],
  LAX: ["california", "west-coast", "us"],
  SFO: ["california", "west-coast", "us"],
  SEA: ["pacific-northwest", "west-coast", "us"],
  PDX: ["pacific-northwest", "west-coast", "us"],
  DEN: ["mountain-west", "us"],
  SLC: ["mountain-west", "us"],
  ASE: ["mountain-west", "ski", "us"],
  BZN: ["mountain-west", "us"],
  JAC: ["mountain-west", "us"],
  PHX: ["southwest", "desert", "us"],
  LAS: ["southwest", "desert", "us"],
  ORD: ["midwest", "us"],
  MSP: ["midwest", "us"],
  STL: ["midwest", "us"],
  MCI: ["midwest", "us"],
  BOS: ["northeast", "us"],
  JFK: ["northeast", "new-york", "us"],
  DCA: ["mid-atlantic", "us"],
  PHL: ["mid-atlantic", "us"],
  ANC: ["alaska", "us"],
  HNL: ["hawaii", "us"],
  OGG: ["hawaii", "us"],
  KOA: ["hawaii", "us"],
  LIH: ["hawaii", "us"],
  CUN: ["mexico", "caribbean-coast"],
  PVR: ["mexico", "pacific-mexico"],
  SJD: ["mexico", "pacific-mexico"],
  SJU: ["caribbean", "puerto-rico", "us"],
  STT: ["caribbean", "usvi", "us"],
  MBJ: ["caribbean", "jamaica"],
  NAS: ["caribbean", "bahamas"],
  PUJ: ["caribbean", "dominican-republic"],
  AUA: ["caribbean", "aruba"],
  SXM: ["caribbean", "st-maarten"],
}

export function regionsFor(iata: string): string[] {
  return REGION_BY_IATA[iata.toUpperCase()] ?? ["other"]
}

/** The region used for the diversity rule: the most specific tag. */
export function primaryRegion(iata: string): string {
  return regionsFor(iata)[0]
}

// ─── Selection ───────────────────────────────────────────────────────────────

export interface DestinationCandidate {
  profile: NormalisedProfile
  /** Best nonstop route among the origin airports (shortest), or null when only drivable */
  route: NonstopRouteRow | null
  originIata: string | null
  /** Great-circle km from the user's origin coordinates */
  distanceKm: number
  drivable: boolean
  regions: string[]
}

export interface SelectDestinationsInput {
  originAirports: string[]
  originLat: number
  originLng: number
  routes: NonstopRouteRow[]
  profiles: NormalisedProfile[]
  constraints: SearchConstraints
  /** Calendar months (1..12) the search window touches, for the `warm` check */
  months: number[]
  caps: {
    maxDestinations: number
    drivingAlternativeMaxKm: number
  }
  /** Max candidates per primary region in the first pass of the diversity rule (default 3) */
  perRegionSoftCap?: number
}

/** High of at least 70°F in every month the window touches. */
export const WARM_HIGH_F = 70

export function isWarmIn(profile: NormalisedProfile, months: number[]): boolean {
  if (!profile.climate || months.length === 0) return false
  return months.every((m) => {
    const c = profile.climate!.find((x) => x.month === m)
    return c != null && c.highF >= WARM_HIGH_F
  })
}

/** Shortest nonstop route from any of the origin airports to `dest`, or null. */
export function pickBestRoute(routes: readonly NonstopRouteRow[], origins: ReadonlySet<string> | readonly string[], dest: string): NonstopRouteRow | null {
  const set = origins instanceof Set ? origins : new Set([...origins].map((o) => o.toUpperCase()))
  const d = dest.toUpperCase()
  let best: NonstopRouteRow | null = null
  for (const r of routes) {
    if (!set.has(r.originIata.toUpperCase()) || r.destIata.toUpperCase() !== d) continue
    if (!best || r.typicalDurationMins < best.typicalDurationMins) best = r
  }
  return best
}

export function selectDestinations(input: SelectDestinationsInput): DestinationCandidate[] {
  const origins = new Set(input.originAirports.map((a) => a.trim().toUpperCase()))
  const c = input.constraints
  const wantedRegions = (c.regions ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean)
  const drivingMaxKm = input.caps.drivingAlternativeMaxKm

  const candidates: DestinationCandidate[] = []
  for (const profile of input.profiles) {
    if (origins.has(profile.iata)) continue // never propose the origin itself

    const distanceKm = haversineDistance(input.originLat, input.originLng, profile.lat, profile.lng)
    const route = pickBestRoute(input.routes, origins, profile.iata)
    const drivable = c.drivingOk === true && distanceKm <= drivingMaxKm

    if (!route && !drivable) continue
    if (c.nonstopOnly && !route && !drivable) continue
    if (route && c.maxFlightMins != null && route.typicalDurationMins > c.maxFlightMins && !drivable) continue

    const regions = regionsFor(profile.iata)
    if (wantedRegions.length && !regions.some((r) => wantedRegions.includes(r))) continue
    if (c.warm && !isWarmIn(profile, input.months)) continue

    candidates.push({ profile, route, originIata: route?.originIata ?? null, distanceKm, drivable, regions })
  }

  // Deterministic base order: quickest to reach first, then by code.
  candidates.sort((a, b) => {
    const ta = a.route ? a.route.typicalDurationMins : a.distanceKm / 1.2 // ~72 km/h all-in driving
    const tb = b.route ? b.route.typicalDurationMins : b.distanceKm / 1.2
    return ta - tb || a.profile.iata.localeCompare(b.profile.iata)
  })

  return applyDiversity(candidates, Math.max(0, Math.floor(input.caps.maxDestinations)), input.perRegionSoftCap ?? 3)
}

/**
 * First pass admits at most `perRegionSoftCap` per primary region in base
 * order; if the cap is not yet reached the remainder fills in base order.
 * Deterministic, and when the region asked for is "florida" it does not
 * starve the list, because the second pass fills whatever is left.
 */
export function applyDiversity<T extends { profile: { iata: string } }>(ordered: T[], cap: number, perRegionSoftCap: number): T[] {
  if (cap <= 0) return []
  const perRegion = new Map<string, number>()
  const picked: T[] = []
  const deferred: T[] = []
  for (const item of ordered) {
    const region = primaryRegion(item.profile.iata)
    const n = perRegion.get(region) ?? 0
    if (n < perRegionSoftCap) {
      perRegion.set(region, n + 1)
      picked.push(item)
    } else {
      deferred.push(item)
    }
    if (picked.length >= cap) return picked.slice(0, cap)
  }
  for (const item of deferred) {
    if (picked.length >= cap) break
    picked.push(item)
  }
  return picked
}
