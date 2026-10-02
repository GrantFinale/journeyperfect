/**
 * Stage runner for the Opportunity Discovery Engine. See
 * docs/plans/opportunity-discovery-engine.md §3.
 *
 * This is the one module under src/lib/opportunities/ that touches the
 * database and external services. Every factor it calls is pure; this file
 * only loads rows, calls factors, and writes rows back.
 *
 * Rules (plan §3):
 *   1. Every stage is idempotent and resumable. `OpportunityCandidate.stage`
 *      is the last completed stage; a stage only processes rows below it.
 *   2. Every cap is a config key. A stage that would exceed its cap refuses
 *      to start (StageRefusedError) rather than trimming silently — except
 *      that stage 1 prunes down to the airfare budget so stage 2 can run.
 *   3. Stage 3 never runs unless `privateRatesAuthorizedAt` is set.
 */
import { Prisma, type OpportunityCandidate, type OpportunitySearch } from "@prisma/client"
import profilesSeed from "@/data/destination-profiles.json"
import routesSeed from "@/data/nonstop-routes.json"
import { checkPrivateRatesForSearch } from "@/lib/actions/private-rates"
import { getAirportCoords } from "@/lib/airports"
import { getConfigKeyNumber } from "@/lib/config-keys"
import { prisma } from "@/lib/db"
import { fetchEvents, type EventSummary } from "@/lib/events"
import { searchWithCache } from "@/lib/flights"
import type { FlightItinerary, FlightQuery } from "@/lib/flights/types"
import { haversineDistance } from "@/lib/haversine"
import { getWeatherForecast, type DayForecast } from "@/lib/weather"
import { getHistoricalWeather } from "@/lib/weather-climate"
import { assembleCoreTripCost, estimateGroundTransport, estimateMajorActivity, hotelStayTotal } from "./cost-estimates"
import { generateDateCandidates } from "./date-candidates"
import { daysBetween, formatYmd, monthsInRange } from "./dates"
import {
  normaliseProfile,
  pickBestRoute,
  selectDestinations,
  type NonstopRouteRow,
  type NormalisedProfile,
} from "./destinations"
import { anchorExperienceFromFacts, evaluateAnchor } from "./factors/anchor"
import { evaluateDoorToDoor, transportationFromFacts } from "./factors/door-to-door"
import { evaluateFamilyFit } from "./factors/family-fit"
import { evaluateGroundFriction } from "./factors/ground-friction"
import { evaluateHotelValue, type RateQuoteLike } from "./factors/hotel-value"
import { evaluateNonstopAirfare, type OfferWithId } from "./factors/nonstop-airfare"
import { evaluateTripLengthFit } from "./factors/trip-length-fit"
import { evaluateWeather, weatherContextFromFacts } from "./factors/weather"
import { detectDateArbitrage, detectOutliers } from "./outliers"
import { mergeReasons, orderReasons } from "./reason-text"
import { rankCandidates, scoreCandidate } from "./scoring"
import { splitAdultsChildren, summariseTravelers, type TravelerSummaryDetail } from "./travelers"
import type { CandidateFactors, FactorSource, OpportunityReason, OpportunitySearchStatus, SearchConstraints } from "./types"

// ─── Public types ────────────────────────────────────────────────────────────

export type StageNumber = 0 | 1 | 2 | 3 | 4

export interface StageOutcome {
  stage: StageNumber
  status: OpportunitySearchStatus
  /** Rows this call advanced */
  processed: number
  /** True when the stage had nothing to do (already complete) */
  skipped: boolean
  note?: string
  /** Stage 3 only: distinct HotelRateQuote rows that matched a shortlisted candidate. */
  quotesUsed?: number
}

/**
 * How stage 3 gets its quotes.
 *   "runner"   (default) run checkPrivateRatesForSearch (the browser runner),
 *              then score from stored quotes.
 *   "captured" never call the runner; score only from HotelRateQuote rows
 *              already stored for the user (≤24h old, not expired), e.g. the
 *              ones the Go Rates Chrome extension posted.
 */
export type PrivateRatesMode = "runner" | "captured"

export interface RunStageOptions {
  privateRatesMode?: PrivateRatesMode
}

export class StageRefusedError extends Error {
  constructor(
    public readonly stage: StageNumber,
    message: string
  ) {
    super(message)
    this.name = "StageRefusedError"
  }
}

export interface PipelineCaps {
  maxDestinations: number
  maxDateCandidates: number
  maxAirfareLookups: number
  maxPrivateRateLookups: number
  drivingAlternativeMaxKm: number
}

/** Constraints may carry a door-to-door ceiling the UI adds later; tolerate it. */
type ExtendedConstraints = SearchConstraints & { maxDoorToDoorMins?: number | null }

/** Forecast horizon of src/lib/weather.ts. */
const FORECAST_DAYS = 16
/** HotelRateQuote must be this close to the candidate's centre to count. */
const HOTEL_MATCH_KM = 40
/** Captured mode only uses quotes retrieved within this window. */
const CAPTURED_QUOTE_MAX_AGE_MS = 24 * 60 * 60_000
/** Route price history window for the airfare baseline. */
const ROUTE_HISTORY_DAYS = 120

// ─── Reference data (DB first, JSON seed fallback) ───────────────────────────

interface SeedRoute {
  originIata: string
  destIata: string
  carriers: string[]
  typicalDurationMins: number
}

export async function loadDestinationProfiles(): Promise<NormalisedProfile[]> {
  let rows: unknown[] = []
  try {
    rows = await prisma.destinationProfile.findMany()
  } catch (err) {
    console.error("[opportunities] destinationProfile read failed, using JSON seed:", err)
  }
  if (rows.length === 0) rows = profilesSeed as unknown[]
  return rows.map(normaliseProfile).filter((p): p is NormalisedProfile => p != null)
}

export async function loadNonstopRoutes(origins: string[]): Promise<NonstopRouteRow[]> {
  const upper = [...new Set(origins.map((o) => o.trim().toUpperCase()).filter((o) => o.length === 3))]
  if (upper.length === 0) return []
  let rows: NonstopRouteRow[] = []
  try {
    rows = await prisma.nonstopRoute.findMany({ where: { originIata: { in: upper } } })
  } catch (err) {
    console.error("[opportunities] nonstopRoute read failed, using JSON seed:", err)
  }
  if (rows.length === 0) {
    rows = (routesSeed as SeedRoute[])
      .filter((r) => upper.includes(r.originIata))
      .map((r) => ({
        originIata: r.originIata,
        destIata: r.destIata,
        carriers: r.carriers,
        weeklyFrequency: null,
        typicalDurationMins: r.typicalDurationMins,
        departureBuckets: [],
        source: "OPENFLIGHTS_SEED",
        lastVerifiedAt: null,
      }))
  }
  return rows
}

export async function loadCaps(): Promise<PipelineCaps> {
  const [maxDestinations, maxDateCandidates, maxAirfareLookups, maxPrivateRateLookups, drivingAlternativeMaxKm] = await Promise.all([
    getConfigKeyNumber("opportunities.maxDestinations"),
    getConfigKeyNumber("opportunities.maxDateCandidates"),
    getConfigKeyNumber("opportunities.maxAirfareLookups"),
    getConfigKeyNumber("opportunities.maxPrivateRateLookups"),
    getConfigKeyNumber("opportunities.drivingAlternativeMaxKm"),
  ])
  return { maxDestinations, maxDateCandidates, maxAirfareLookups, maxPrivateRateLookups, drivingAlternativeMaxKm }
}

// ─── Shared context ──────────────────────────────────────────────────────────

interface SearchContext {
  search: OpportunitySearch
  constraints: ExtendedConstraints
  caps: PipelineCaps
  profiles: Map<string, NormalisedProfile>
  routes: NonstopRouteRow[]
  travelers: TravelerSummaryDetail
  airportArrivalBufferMins: number
  today: string
}

async function loadContext(searchId: string): Promise<SearchContext> {
  const search = await prisma.opportunitySearch.findUnique({ where: { id: searchId } })
  if (!search) throw new Error(`OpportunitySearch ${searchId} not found`)

  const [caps, profileList, routes, travelerRows, prefs] = await Promise.all([
    loadCaps(),
    loadDestinationProfiles(),
    loadNonstopRoutes(search.originAirports),
    prisma.travelerProfile.findMany({
      where: { id: { in: search.travelerProfileIds }, userId: search.userId },
      select: { birthDate: true, tags: true, preferences: true },
    }),
    prisma.userPreferences.findUnique({ where: { userId: search.userId }, select: { airportArrivalBufferMins: true } }),
  ])

  const travelers = summariseTravelers(travelerRows.length ? travelerRows : [{ tags: ["adult"] }])
  return {
    search,
    constraints: ((search.constraints as ExtendedConstraints | null) ?? {}) as ExtendedConstraints,
    caps,
    profiles: new Map(profileList.map((p) => [p.iata, p])),
    routes,
    travelers,
    airportArrivalBufferMins: prefs?.airportArrivalBufferMins ?? 90,
    today: formatYmd(new Date()),
  }
}

function ymdToDb(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

function factorsOf(c: OpportunityCandidate): CandidateFactors {
  return ((c.factors as CandidateFactors | null) ?? {}) as CandidateFactors
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

async function setStatus(searchId: string, status: OpportunitySearchStatus, completed = false) {
  await prisma.opportunitySearch.update({
    where: { id: searchId },
    data: { status, ...(completed ? { completedAt: new Date() } : {}) },
  })
}

function liveCandidates(rows: OpportunityCandidate[], minStage: number): OpportunityCandidate[] {
  return rows.filter((c) => !c.pruned && c.stage >= minStage)
}

// ─── Stage 0: bound the space ────────────────────────────────────────────────

async function runStage0(ctx: SearchContext): Promise<StageOutcome> {
  const { search, caps, constraints } = ctx
  const existing = await prisma.opportunityCandidate.count({ where: { searchId: search.id } })
  if (existing > 0) return { stage: 0, status: "STAGE_0", processed: 0, skipped: true }

  await setStatus(search.id, "STAGE_0")
  const windowStart = formatYmd(search.windowStart)
  const windowEnd = formatYmd(search.windowEnd)

  const dates = generateDateCandidates({
    windowStart,
    windowEnd,
    nightsMin: search.nightsMin,
    nightsMax: search.nightsMax,
    weekdayPattern: search.weekdayPattern,
    cap: caps.maxDateCandidates,
  })
  const destinations = selectDestinations({
    originAirports: search.originAirports,
    originLat: search.originLat,
    originLng: search.originLng,
    routes: ctx.routes,
    profiles: [...ctx.profiles.values()],
    constraints,
    months: monthsInRange(windowStart, windowEnd),
    caps: { maxDestinations: caps.maxDestinations, drivingAlternativeMaxKm: caps.drivingAlternativeMaxKm },
  })

  const total = dates.length * destinations.length
  if (total === 0) {
    await setStatus(search.id, "DONE", true)
    return { stage: 0, status: "DONE", processed: 0, skipped: false, note: dates.length === 0 ? "No date windows fit" : "No destinations match" }
  }
  if (total > caps.maxDestinations * caps.maxDateCandidates) {
    throw new StageRefusedError(0, `${total} candidates would exceed the cap of ${caps.maxDestinations * caps.maxDateCandidates}`)
  }

  await prisma.opportunityCandidate.createMany({
    data: destinations.flatMap((d) =>
      dates.map((dt) => ({
        searchId: search.id,
        destinationIata: d.profile.iata,
        destinationName: d.profile.name,
        destinationLat: d.profile.lat,
        destinationLng: d.profile.lng,
        checkIn: ymdToDb(dt.checkIn),
        checkOut: ymdToDb(dt.checkOut),
        nights: dt.nights,
        stage: 0,
        factors: {},
      }))
    ),
  })
  return { stage: 0, status: "STAGE_0", processed: total, skipped: false }
}

// ─── Stage 1: free factors + prune ───────────────────────────────────────────

async function forecastFor(cache: Map<string, Promise<DayForecast[]>>, iata: string, lat: number, lng: number): Promise<DayForecast[]> {
  let p = cache.get(iata)
  if (!p) {
    p = getWeatherForecast(lat, lng).catch(() => [])
    cache.set(iata, p)
  }
  return p
}

async function runStage1(ctx: SearchContext): Promise<StageOutcome> {
  const { search, caps, constraints, travelers } = ctx
  const all = await prisma.opportunityCandidate.findMany({ where: { searchId: search.id } })
  const todo = all.filter((c) => !c.pruned && c.stage < 1)
  if (todo.length === 0) return { stage: 1, status: "STAGE_1", processed: 0, skipped: true }
  await setStatus(search.id, "STAGE_1")

  const origins = new Set(search.originAirports.map((a) => a.toUpperCase()))
  const forecastCache = new Map<string, Promise<DayForecast[]>>()
  const updates: { id: string; factors: CandidateFactors; pruned: boolean; prunedReason: string | null; score: number }[] = []

  for (const c of todo) {
    const checkIn = formatYmd(c.checkIn)
    const checkOut = formatYmd(c.checkOut)
    const profile = ctx.profiles.get(c.destinationIata)
    if (!profile) {
      updates.push({ id: c.id, factors: {}, pruned: true, prunedReason: "No destination profile", score: -1 })
      continue
    }
    const route = pickBestRoute(ctx.routes, origins, c.destinationIata)
    const distanceKm = haversineDistance(search.originLat, search.originLng, profile.lat, profile.lng)
    const drivable = constraints.drivingOk === true && distanceKm <= caps.drivingAlternativeMaxKm

    // Weather: forecast when the whole stay is inside the horizon, else climate.
    const withinForecast = daysBetween(ctx.today, checkOut) <= FORECAST_DAYS && daysBetween(ctx.today, checkIn) >= 0
    const forecast = withinForecast ? await forecastFor(forecastCache, c.destinationIata, profile.lat, profile.lng) : null
    const historical = !withinForecast && !profile.climate ? await getHistoricalWeather(profile.lat, profile.lng, checkIn, checkOut) : null

    let events: EventSummary[] = []
    try {
      events = await fetchEvents(profile.lat, profile.lng, checkIn, checkOut)
    } catch {
      events = []
    }
    const nowIso = new Date().toISOString()

    const anchor = evaluateAnchor({ anchors: profile.anchors, checkIn, checkOut, events, destinationName: profile.name, eventsRetrievedAt: nowIso })
    const weather = evaluateWeather({
      checkIn,
      checkOut,
      forecast,
      climate: profile.climate,
      historical: historical ? { highF: historical.highF, lowF: historical.lowF, precipPct: historical.precipPct } : null,
      wantWarm: constraints.warm === true,
      weatherDependentAnchor: anchor.available && anchor.facts.weatherDependent === true,
      retrievedAt: nowIso,
    })
    const airport = route ? getAirportCoords(route.originIata) : undefined
    const doorToDoor = evaluateDoorToDoor({
      homeLat: search.originLat,
      homeLng: search.originLng,
      airport: route && airport ? { iata: route.originIata, lat: airport.lat, lng: airport.lng } : null,
      flightMins: route?.typicalDurationMins ?? null,
      airportArrivalBufferMins: ctx.airportArrivalBufferMins,
      airportToCenterKm: profile.airportToCenterKm,
      destinationLat: profile.lat,
      destinationLng: profile.lng,
      drivingAlternativeMaxKm: drivable ? caps.drivingAlternativeMaxKm : 0,
      maxDoorToDoorMins: constraints.maxDoorToDoorMins ?? null,
    })
    const { nonstop } = evaluateNonstopAirfare({
      offers: [],
      route,
      travelerCount: travelers.count,
      nonstopOnly: constraints.nonstopOnly,
      originIata: route?.originIata,
      destinationIata: c.destinationIata,
    })

    const factors: CandidateFactors = {
      tripLengthFit: evaluateTripLengthFit({ nights: c.nights, idealNightsMin: profile.idealNightsMin, idealNightsMax: profile.idealNightsMax, destinationName: profile.name }),
      familyFit: evaluateFamilyFit({ travelers, familyFit: profile.familyFit, destinationName: profile.name }),
      anchor,
      weather,
      doorToDoor,
      groundFriction: evaluateGroundFriction({
        walkable: profile.walkable,
        carNeeded: profile.carNeeded,
        parkingTypical: profile.parkingTypical,
        activitiesDispersed: profile.activitiesDispersed,
        partySize: travelers.count,
      }),
    }
    if (nonstop.available) factors.nonstop = nonstop

    // Hard prunes.
    let prunedReason: string | null = null
    if (constraints.nonstopOnly && !route && !drivable) prunedReason = "No nonstop route from your airports"
    else if (constraints.maxFlightMins != null && route && route.typicalDurationMins > constraints.maxFlightMins && !drivable)
      prunedReason = `Flight longer than ${constraints.maxFlightMins} min`
    else if (constraints.warm && weather.available && Number(weather.facts.highF) < 65) prunedReason = "Not warm on these dates"
    else if ((factors.tripLengthFit?.score ?? 1) <= 0.25) prunedReason = "Trip length far from ideal"
    else if (travelers.childCount > 0 && factors.familyFit?.available && Number(factors.familyFit.facts.ageBandFit) <= 0.2 && factors.familyFit.facts.ageBandFit !== "")
      prunedReason = "Little for the kids here"

    const score = scoreCandidate({ id: c.id, factors, constraints, maxDoorToDoorMins: constraints.maxDoorToDoorMins ?? null }).score
    updates.push({ id: c.id, factors, pruned: prunedReason != null, prunedReason, score })
  }

  // Soft prunes: keep the best destinations, then fit the airfare budget.
  const survivors = updates.filter((u) => !u.pruned)
  const destBest = new Map<string, number>()
  const destOf = new Map(todo.map((c) => [c.id, c.destinationIata]))
  for (const u of survivors) {
    const iata = destOf.get(u.id)!
    destBest.set(iata, Math.max(destBest.get(iata) ?? -Infinity, u.score))
  }
  const keptDests = new Set([...destBest.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, caps.maxDestinations).map(([iata]) => iata))
  for (const u of survivors) {
    if (!keptDests.has(destOf.get(u.id)!)) {
      u.pruned = true
      u.prunedReason = `Outside the top ${caps.maxDestinations} destinations`
    }
  }
  const stillAlive = updates.filter((u) => !u.pruned).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const alreadyPriced = all.filter((c) => !c.pruned && c.stage >= 2).length
  const budget = Math.max(0, caps.maxAirfareLookups - alreadyPriced)
  for (const u of stillAlive.slice(budget)) {
    u.pruned = true
    u.prunedReason = `Outside the airfare lookup budget (${caps.maxAirfareLookups})`
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.opportunityCandidate.update({
        where: { id: u.id },
        data: { factors: json(u.factors), stage: 1, pruned: u.pruned, prunedReason: u.prunedReason, score: u.score },
      })
    )
  )
  return { stage: 1, status: "STAGE_1", processed: updates.length, skipped: false }
}

// ─── Stage 2: airfare via the flights layer ──────────────────────────────────

interface OfferRowLike {
  id: string
  provider: string
  providerRef: string | null
  totalPrice: number
  currency: string
  carrierCodes: string[]
  stops: number
  durationMins: number
  outbound: unknown
  inbound: unknown
  bookingUrl: string
  expiresAt: Date | null
}

function toOfferWithId(row: OfferRowLike): OfferWithId {
  const o: OfferWithId = {
    id: row.id,
    provider: row.provider,
    totalPrice: row.totalPrice,
    currency: row.currency,
    carrierCodes: row.carrierCodes,
    stops: row.stops,
    durationMins: row.durationMins,
    outbound: row.outbound as FlightItinerary,
    bookingUrl: row.bookingUrl,
  }
  if (row.providerRef) o.providerRef = row.providerRef
  if (row.inbound) o.inbound = row.inbound as FlightItinerary
  if (row.expiresAt) o.expiresAt = row.expiresAt.toISOString()
  return o
}

async function routeHistoryTotals(origin: string, destination: string): Promise<number[]> {
  try {
    const since = new Date(Date.now() - ROUTE_HISTORY_DAYS * 86_400_000)
    const points = await prisma.flightPricePoint.findMany({
      where: { capturedAt: { gte: since }, search: { origin, destination } },
      select: { price: true },
      take: 200,
      orderBy: { capturedAt: "desc" },
    })
    return points.map((p) => p.price)
  } catch {
    return []
  }
}

async function runStage2(ctx: SearchContext): Promise<StageOutcome> {
  const { search, caps, constraints, travelers } = ctx
  const all = await prisma.opportunityCandidate.findMany({ where: { searchId: search.id } })
  const todo = all.filter((c) => !c.pruned && c.stage === 1)
  if (todo.length === 0) return { stage: 2, status: "STAGE_2", processed: 0, skipped: true }
  if (todo.length > caps.maxAirfareLookups) {
    throw new StageRefusedError(2, `${todo.length} airfare lookups would exceed opportunities.maxAirfareLookups (${caps.maxAirfareLookups})`)
  }
  await setStatus(search.id, "STAGE_2")

  const origins = new Set(search.originAirports.map((a) => a.toUpperCase()))
  const { adults, children } = splitAdultsChildren(travelers.ages)
  let lookupsUsed = 0

  interface Priced {
    c: OpportunityCandidate
    route: NonstopRouteRow | null
    origin: string
    offers: OfferWithId[]
    flightSearchId: string | null
    retrievedAt: string
    error?: string
  }
  const priced: Priced[] = []

  for (const c of todo) {
    const route = pickBestRoute(ctx.routes, origins, c.destinationIata)
    const origin = route?.originIata ?? search.originAirports[0]?.toUpperCase()
    const entry: Priced = { c, route, origin, offers: [], flightSearchId: null, retrievedAt: new Date().toISOString() }
    if (!origin) {
      entry.error = "No origin airport"
      priced.push(entry)
      continue
    }
    const base: FlightQuery = {
      origin,
      destination: c.destinationIata,
      departDate: formatYmd(c.checkIn),
      returnDate: formatYmd(c.checkOut),
      cabin: "economy",
      adults,
      children,
      maxStops: 0,
      currency: "USD",
    }
    try {
      // Nonstop-only first; the cache makes a repeat query free.
      const flightCtx = { userId: search.userId }
      let { searchId: fsId, result } = await searchWithCache(base, flightCtx)
      lookupsUsed++
      if (result.offers.length === 0 && !constraints.nonstopOnly && lookupsUsed < caps.maxAirfareLookups) {
        const fallback = await searchWithCache({ ...base, maxStops: 1 }, flightCtx)
        lookupsUsed++
        if (fallback.result.offers.length > 0) {
          fsId = fallback.searchId
          result = fallback.result
        }
      }
      entry.flightSearchId = fsId
      entry.retrievedAt = result.retrievedAt
      const rows = await prisma.flightOffer.findMany({ where: { searchId: fsId }, orderBy: { totalPrice: "asc" } })
      entry.offers = rows.length ? rows.map(toOfferWithId) : result.offers.map((o) => ({ ...o }))
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
      console.error(`[opportunities] airfare lookup failed for ${origin}→${c.destinationIata}:`, err)
    }
    priced.push(entry)
  }

  // Baselines need every candidate priced first.
  const bestTotal = (p: Priced): number | null => {
    if (p.offers.length === 0) return null
    const nonstop = p.offers.filter((o) => o.stops === 0)
    const pool = nonstop.length ? nonstop : p.offers
    return Math.min(...pool.map((o) => o.totalPrice))
  }
  const historyCache = new Map<string, Promise<number[]>>()

  const evaluated = await Promise.all(
    priced.map(async (p) => {
      const others = priced
        .filter((q) => q !== p && q.c.destinationIata === p.c.destinationIata)
        .map(bestTotal)
        .filter((n): n is number => n != null)
      const histKey = `${p.origin}-${p.c.destinationIata}`
      let hist = historyCache.get(histKey)
      if (!hist) {
        hist = p.origin ? routeHistoryTotals(p.origin, p.c.destinationIata) : Promise.resolve([])
        historyCache.set(histKey, hist)
      }
      const { nonstop, airfare } = evaluateNonstopAirfare({
        offers: p.offers,
        route: p.route,
        travelerCount: travelers.count,
        nonstopOnly: constraints.nonstopOnly,
        otherDateTotals: others,
        routeHistory: await hist,
        retrievedAt: p.retrievedAt,
        originIata: p.origin,
        destinationIata: p.c.destinationIata,
      })
      const factors = factorsOf(p.c)
      factors.nonstop = nonstop.available ? nonstop : factors.nonstop
      factors.airfare = p.error ? { ...airfare, facts: { ...airfare.facts, error: p.error } } : airfare
      const score = scoreCandidate({ id: p.c.id, factors, constraints, maxDoorToDoorMins: constraints.maxDoorToDoorMins ?? null }).score
      return { id: p.c.id, factors, flightSearchId: p.flightSearchId, score }
    })
  )
  await prisma.$transaction(
    evaluated.map((e) =>
      prisma.opportunityCandidate.update({
        where: { id: e.id },
        data: { factors: json(e.factors), flightSearchId: e.flightSearchId, stage: 2, score: e.score },
      })
    )
  )
  return { stage: 2, status: "STAGE_2", processed: priced.length, skipped: false, note: `${lookupsUsed} lookups` }
}

// ─── Stage 3: private rates (explicit authorisation only) ────────────────────

async function runStage3(ctx: SearchContext, mode: PrivateRatesMode = "runner"): Promise<StageOutcome> {
  const { search, caps } = ctx
  if (!search.privateRatesAuthorizedAt) {
    throw new StageRefusedError(3, "Private rates were not authorised for this search")
  }
  const all = await prisma.opportunityCandidate.findMany({ where: { searchId: search.id } })
  const live = liveCandidates(all, 2).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id))
  if (live.length === 0) return { stage: 3, status: "STAGE_3", processed: 0, skipped: true }
  await setStatus(search.id, "STAGE_3")

  // The private-rates action owns its own property cap; we bound which
  // candidates we evaluate quotes for. Captured mode reads only stored quotes
  // (no Hilton traffic), so every live candidate is evaluated: the extension
  // plan can cover candidates outside the runner's shortlist.
  const shortlist = mode === "captured" ? live : live.slice(0, Math.max(caps.maxPrivateRateLookups, 1) * 3)
  const check: { status: string; quotesWritten: number } =
    mode === "captured" ? { status: "CAPTURED", quotesWritten: 0 } : await checkPrivateRatesForSearch(search.id)

  const now = new Date()
  const quotes = await prisma.hotelRateQuote.findMany({
    where: {
      userId: search.userId,
      expiresAt: { gt: now },
      ...(mode === "captured" ? { retrievedAt: { gte: new Date(now.getTime() - CAPTURED_QUOTE_MAX_AGE_MS) } } : {}),
      checkIn: { gte: search.windowStart },
      checkOut: { lte: new Date(search.windowEnd.getTime() + 86_400_000) },
    },
  })
  const usedQuoteIds = new Set<string>()

  const updates = shortlist.map((c) => {
    const checkIn = formatYmd(c.checkIn)
    const checkOut = formatYmd(c.checkOut)
    const matching: RateQuoteLike[] = quotes
      .filter(
        (q) =>
          formatYmd(q.checkIn) === checkIn &&
          formatYmd(q.checkOut) === checkOut &&
          q.lat != null &&
          q.lng != null &&
          haversineDistance(q.lat, q.lng, c.destinationLat, c.destinationLng) <= HOTEL_MATCH_KM
      )
      .map((q) => ({
        id: q.id,
        propertyCode: q.propertyCode,
        propertyName: q.propertyName,
        brand: q.brand,
        tier: q.tier,
        rateKind: q.rateKind,
        nightlyRate: q.nightlyRate,
        totalRate: q.totalRate,
        currency: q.currency,
        available: q.available,
        retrievedAt: q.retrievedAt,
      }))
    for (const q of matching) usedQuoteIds.add(q.id)
    const profile = ctx.profiles.get(c.destinationIata)
    const { pair: _pair, ...hotelValue } = evaluateHotelValue({ quotes: matching, nights: c.nights, destinationTier: profile?.tier ?? null })
    void _pair
    const factors = factorsOf(c)
    factors.hotelValue = { ...hotelValue, facts: { ...hotelValue.facts, checkStatus: check.status } }
    const score = scoreCandidate({ id: c.id, factors, constraints: ctx.constraints, maxDoorToDoorMins: ctx.constraints.maxDoorToDoorMins ?? null }).score
    return prisma.opportunityCandidate.update({ where: { id: c.id }, data: { factors: json(factors), stage: Math.max(c.stage, 3), score } })
  })
  await prisma.$transaction(updates)
  const note = mode === "captured" ? `CAPTURED, ${usedQuoteIds.size} quotes used` : `${check.status}, ${check.quotesWritten} quotes`
  return { stage: 3, status: "STAGE_3", processed: updates.length, skipped: false, note, quotesUsed: usedQuoteIds.size }
}

// ─── Stage 4: outliers, scoring, TravelOpportunity rows ──────────────────────

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return null
}

async function runStage4(ctx: SearchContext): Promise<StageOutcome> {
  const { search, constraints, travelers } = ctx
  const all = await prisma.opportunityCandidate.findMany({ where: { searchId: search.id } })
  const live = liveCandidates(all, 1)
  await setStatus(search.id, "STAGE_4")

  // Drop stale opportunities for pruned or vanished candidates.
  await prisma.travelOpportunity.deleteMany({
    where: { searchId: search.id, candidateId: { notIn: live.map((c) => c.id) } },
  })
  if (live.length === 0) {
    await setStatus(search.id, "DONE", true)
    return { stage: 4, status: "DONE", processed: 0, skipped: false, note: "No candidates survived" }
  }

  const origins = new Set(search.originAirports.map((a) => a.toUpperCase()))

  // Pass 1: costs.
  const prepared = live.map((c) => {
    const f = factorsOf(c)
    const profile = ctx.profiles.get(c.destinationIata)
    const airfareTotal = f.airfare?.available ? num(f.airfare.facts.partyTotal) : null
    const airfareSource: FactorSource = f.airfare?.available ? f.airfare.source : "UNKNOWN"
    const hotelTotal = f.hotelValue?.available ? hotelStayTotal(f.hotelValue.facts, c.nights) : null
    const hotelSource: FactorSource = f.hotelValue?.available ? f.hotelValue.source : "UNKNOWN"
    const mode = f.doorToDoor?.facts.mode === "DRIVE" ? "DRIVE" : "FLY"
    const ground = profile
      ? estimateGroundTransport(profile, c.nights, travelers.count, mode)
      : { total: 0, label: "unknown", source: "ESTIMATED" as FactorSource }
    const anchorKind = f.anchor?.available
      ? { kind: String(f.anchor.facts.anchorKind ?? "OTHER"), rawKind: String(f.anchor.facts.anchorRawKind ?? "") || undefined }
      : null
    const activity = estimateMajorActivity(anchorKind, travelers.ages, c.nights)
    const core = assembleCoreTripCost({
      airfareTotal,
      airfareSource,
      hotelTotal,
      hotelSource,
      groundTransportEstimate: ground.total,
      majorActivityEstimate: activity.total,
    })
    return { c, f, profile, airfareTotal, airfareSource, hotelTotal, ground, activity, core }
  })

  // Pass 2: outliers, arbitrage, ranking.
  const shortlistCoreCosts = prepared.map((p) => p.core.total).filter((n): n is number => n != null)
  const arbitrage = detectDateArbitrage(
    prepared.map((p) => ({ id: p.c.id, destinationIata: p.c.destinationIata, checkIn: formatYmd(p.c.checkIn), airfareTotal: p.airfareTotal }))
  )
  const ranked = rankCandidates(
    prepared.map((p) => ({ id: p.c.id, factors: p.f, constraints, maxDoorToDoorMins: constraints.maxDoorToDoorMins ?? null }))
  )
  const rankById = new Map(ranked.map((r) => [r.id, r]))
  const now = new Date()

  const writes: Prisma.PrismaPromise<unknown>[] = []
  for (const p of prepared) {
    const { c, f } = p
    const route = pickBestRoute(ctx.routes, origins, c.destinationIata)
    const factorReasons = Object.values(f).flatMap((fr) => (fr && fr.available ? fr.reasons : []))
    const outlierReasons = detectOutliers(
      {
        id: c.id,
        destinationIata: c.destinationIata,
        destinationName: c.destinationName,
        checkIn: formatYmd(c.checkIn),
        nights: c.nights,
        travelerCount: travelers.count,
        destinationTier: p.profile?.tier ?? null,
        factors: f,
        coreTripCost: p.core.total,
        route: route ? { source: route.source, weeklyFrequency: route.weeklyFrequency, lastVerifiedAt: route.lastVerifiedAt } : null,
      },
      { shortlistCoreCosts, now }
    )
    const arb = arbitrage.get(c.id)
    const reasons: OpportunityReason[] = orderReasons(mergeReasons(outlierReasons, factorReasons, arb ? [arb] : []))
    const rank = rankById.get(c.id)
    const headline = rank?.headlineFactor ?? reasons[0]?.factor ?? "tripLengthFit"

    const hotel = f.hotelValue?.available ? f.hotelValue.facts : null
    const airfareFacts = f.airfare?.available ? f.airfare.facts : null
    const data = {
      destinationName: c.destinationName,
      destinationIata: c.destinationIata,
      checkIn: c.checkIn,
      checkOut: c.checkOut,
      nights: c.nights,
      travelerCount: travelers.count,
      nonstopAvailable: f.nonstop?.available === true && (f.nonstop.facts.nonstopFound === true || (f.nonstop.source === "ESTIMATED" && f.nonstop.facts.nonstopKnown === true)),
      flightOfferId: airfareFacts && typeof airfareFacts.offerId === "string" && airfareFacts.offerId ? airfareFacts.offerId : null,
      transportation: json(transportationFromFacts(f.doorToDoor, f.airfare)),
      airfareTotal: p.airfareTotal,
      airfareSource: p.airfareSource,
      hotelRateQuoteId: hotel && typeof hotel.hotelRateQuoteId === "string" && hotel.hotelRateQuoteId ? hotel.hotelRateQuoteId : null,
      publicRateQuoteId: hotel && typeof hotel.publicRateQuoteId === "string" && hotel.publicRateQuoteId ? hotel.publicRateQuoteId : null,
      hotelName: hotel ? String(hotel.hotelName ?? "") || null : null,
      privateNightlyRate: hotel ? num(hotel.privateNightlyRate) : null,
      comparablePublicRate: hotel ? num(hotel.comparablePublicRate) : null,
      hotelSavingsTotal: hotel ? num(hotel.savingsTotal) : null,
      groundTransportEstimate: p.ground.total,
      majorActivityEstimate: p.activity.total,
      coreTripCost: p.core.total,
      coreTripCostSource: p.core.source,
      weatherContext: json(weatherContextFromFacts(f.weather)),
      anchorExperience: anchorExperienceFromFacts(f.anchor) ? json(anchorExperienceFromFacts(f.anchor)) : Prisma.JsonNull,
      familyFitReasons: (f.familyFit?.reasons ?? []).filter((r) => r.polarity === "POSITIVE").map((r) => (r.detail ? `${r.headline}: ${r.detail}` : r.headline)),
      opportunityReasons: json(reasons),
      headlineFactor: headline,
      retrievedAt: now,
    }

    const existingId = await existingOpportunityId(search.id, c.id)
    writes.push(
      existingId
        ? prisma.travelOpportunity.update({ where: { id: existingId }, data })
        : prisma.travelOpportunity.create({ data: { searchId: search.id, candidateId: c.id, userId: search.userId, ...data } })
    )
    writes.push(
      prisma.opportunityCandidate.update({
        where: { id: c.id },
        data: { score: rank?.score ?? null, headlineFactor: headline, stage: Math.max(c.stage, 4) },
      })
    )
  }
  await prisma.$transaction(writes)
  await setStatus(search.id, "DONE", true)
  return { stage: 4, status: "DONE", processed: prepared.length, skipped: false }
}

async function existingOpportunityId(searchId: string, candidateId: string): Promise<string | null> {
  const row = await prisma.travelOpportunity.findFirst({ where: { searchId, candidateId }, select: { id: true } })
  return row?.id ?? null
}

// ─── Entry points ────────────────────────────────────────────────────────────

/**
 * Run one stage. Idempotent: rows already past the stage are left alone.
 * Throws StageRefusedError when a cap or the stage-3 authorisation gate would
 * be violated; the caller decides whether that is a FAILED search.
 */
export async function runStage(searchId: string, stage: StageNumber, opts: RunStageOptions = {}): Promise<StageOutcome> {
  const ctx = await loadContext(searchId)
  switch (stage) {
    case 0:
      return runStage0(ctx)
    case 1:
      return runStage1(ctx)
    case 2:
      return runStage2(ctx)
    case 3:
      return runStage3(ctx, opts.privateRatesMode ?? "runner")
    case 4:
      return runStage4(ctx)
  }
}

export interface RunSearchResult {
  status: OpportunitySearchStatus
  outcomes: StageOutcome[]
  error?: string
}

/**
 * Run stages 0 → 2, then 3 only if the search is authorised for private
 * rates, then 4. `throughStage` stops early (e.g. 1 for a free-only preview).
 */
export async function runSearch(searchId: string, opts: { throughStage?: StageNumber } = {}): Promise<RunSearchResult> {
  const through = opts.throughStage ?? 4
  const outcomes: StageOutcome[] = []
  try {
    for (const stage of [0, 1, 2] as StageNumber[]) {
      if (stage > through) break
      const out = await runStage(searchId, stage)
      outcomes.push(out)
      if (out.status === "DONE") return { status: "DONE", outcomes } // nothing to search
    }
    if (through >= 3) {
      const search = await prisma.opportunitySearch.findUnique({ where: { id: searchId }, select: { privateRatesAuthorizedAt: true } })
      if (search?.privateRatesAuthorizedAt) {
        try {
          outcomes.push(await runStage(searchId, 3))
        } catch (err) {
          // Private rates failing must never sink the free result.
          console.error("[opportunities] stage 3 failed, continuing to scoring:", err)
        }
      }
    }
    if (through >= 4) outcomes.push(await runStage(searchId, 4))
    const final = outcomes[outcomes.length - 1]?.status ?? "DRAFT"
    return { status: final, outcomes }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[opportunities] search ${searchId} failed:`, err)
    await setStatus(searchId, "FAILED").catch(() => {})
    return { status: "FAILED", outcomes, error: message }
  }
}

/** Candidate counts for the progress indicator. */
export async function candidateCounts(searchId: string): Promise<{ total: number; pruned: number; byStage: Record<number, number> }> {
  const rows = await prisma.opportunityCandidate.findMany({ where: { searchId }, select: { stage: true, pruned: true } })
  const byStage: Record<number, number> = {}
  let pruned = 0
  for (const r of rows) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1
    if (r.pruned) pruned++
  }
  return { total: rows.length, pruned, byStage }
}
