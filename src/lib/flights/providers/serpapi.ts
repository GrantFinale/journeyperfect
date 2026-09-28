/**
 * SerpApi Google Flights provider. Discovery plus Google's Price Insights.
 * See docs/plans/flights-search-tracking-and-booking.md §3.3 and §3.2 for
 * the litigation risk that makes this swappable by config.
 *
 * The mapper (`mapSerpApiResponse`) is pure and tested against a fixture;
 * the class only adds the HTTP call. Credentials are injected so this module
 * never imports config/Prisma.
 */
import type { FlightProvider } from "../provider"
import type { FlightItinerary, FlightOfferResult, FlightQuery, FlightSegment, PriceInsight, PriceLevel, ProviderSearchResult } from "../types"
import { ProviderNotConfiguredError, ProviderRequestError } from "../errors"
import { googleFlightsUrl } from "../deeplinks"
import { toLocalIso } from "../time"

export const SERPAPI_PROVIDER_ID = "serpapi"
export const SERPAPI_ENDPOINT = "https://serpapi.com/search.json"

// ─── Response shapes (only the fields we read) ─────────────────────────────

export interface SerpApiAirportRef {
  name?: string
  id?: string
  /** "2026-12-01 08:05" */
  time?: string
}

export interface SerpApiFlightLeg {
  departure_airport?: SerpApiAirportRef
  arrival_airport?: SerpApiAirportRef
  /** minutes */
  duration?: number
  airline?: string
  /** "DL 1234" */
  flight_number?: string
  travel_class?: string
}

export interface SerpApiLayover {
  duration?: number
  name?: string
  id?: string
}

export interface SerpApiItinerary {
  flights?: SerpApiFlightLeg[]
  layovers?: SerpApiLayover[]
  /** minutes */
  total_duration?: number
  price?: number
  /** "Round trip" | "One way" */
  type?: string
  departure_token?: string
  booking_token?: string
}

export interface SerpApiPriceInsights {
  lowest_price?: number
  /** "low" | "typical" | "high" */
  price_level?: string
  typical_price_range?: [number, number]
}

export interface SerpApiGoogleFlightsResponse {
  best_flights?: SerpApiItinerary[]
  other_flights?: SerpApiItinerary[]
  price_insights?: SerpApiPriceInsights
  error?: string
  search_metadata?: { status?: string }
}

// ─── Query mapping ─────────────────────────────────────────────────────────

const TRAVEL_CLASS: Record<FlightQuery["cabin"], string> = {
  economy: "1",
  premium_economy: "2",
  business: "3",
  first: "4",
}

/** SerpApi `stops`: 0 any, 1 nonstop only, 2 one stop or fewer, 3 two or fewer. */
function stopsParam(maxStops: number | undefined): string {
  if (maxStops === undefined || maxStops === null || maxStops < 0) return "0"
  if (maxStops === 0) return "1"
  if (maxStops === 1) return "2"
  return "3"
}

export function buildSerpApiParams(q: FlightQuery, apiKey: string): URLSearchParams {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: q.origin.trim().toUpperCase(),
    arrival_id: q.destination.trim().toUpperCase(),
    outbound_date: q.departDate.trim(),
    type: q.returnDate ? "1" : "2",
    adults: String(Math.max(1, q.adults)),
    travel_class: TRAVEL_CLASS[q.cabin] ?? "1",
    stops: stopsParam(q.maxStops),
    currency: (q.currency || "USD").trim().toUpperCase(),
    hl: "en",
    api_key: apiKey,
  })
  if (q.returnDate) params.set("return_date", q.returnDate.trim())
  if (q.children > 0) params.set("children", String(q.children))
  return params
}

// ─── Response mapping ──────────────────────────────────────────────────────

function carrierCodeFromFlightNumber(flightNumber: string | undefined): string | undefined {
  if (!flightNumber) return undefined
  const m = /^([A-Z0-9]{2,3})\s*\d+/i.exec(flightNumber.trim())
  return m ? m[1].toUpperCase() : undefined
}

function mapLeg(leg: SerpApiFlightLeg): FlightSegment | null {
  const from = leg.departure_airport?.id?.trim().toUpperCase()
  const to = leg.arrival_airport?.id?.trim().toUpperCase()
  const departAt = leg.departure_airport?.time
  const arriveAt = leg.arrival_airport?.time
  if (!from || !to || !departAt || !arriveAt) return null
  const carrier = carrierCodeFromFlightNumber(leg.flight_number) ?? (leg.airline ? leg.airline.slice(0, 2).toUpperCase() : "??")
  return {
    carrier,
    carrierName: leg.airline,
    flightNumber: leg.flight_number?.replace(/\s+/g, " ").trim(),
    from,
    to,
    departAt: toLocalIso(departAt),
    arriveAt: toLocalIso(arriveAt),
    durationMins: typeof leg.duration === "number" ? leg.duration : 0,
  }
}

/**
 * One SerpApi itinerary -> one offer. For round trips SerpApi returns the
 * outbound legs with a round-trip `price`; the return legs need a second call
 * with `departure_token`, which we deliberately do not make (cost). `inbound`
 * is therefore undefined and the booking link is the Google Flights search.
 */
export function mapSerpApiItinerary(it: SerpApiItinerary, q: FlightQuery, retrievedAt: string): FlightOfferResult | null {
  const legs = (it.flights ?? []).map(mapLeg).filter((s): s is FlightSegment => s !== null)
  if (legs.length === 0) return null
  if (typeof it.price !== "number" || !Number.isFinite(it.price)) return null

  const layoverMins = (it.layovers ?? []).reduce((sum, l) => sum + (l.duration ?? 0), 0)
  const legMins = legs.reduce((sum, s) => sum + s.durationMins, 0)
  const durationMins = typeof it.total_duration === "number" && it.total_duration > 0 ? it.total_duration : legMins + layoverMins

  const outbound: FlightItinerary = {
    segments: legs,
    durationMins,
    stops: Math.max(0, legs.length - 1),
  }
  const carrierCodes = [...new Set(legs.map((s) => s.carrier).filter((c) => c && c !== "??"))]

  return {
    provider: SERPAPI_PROVIDER_ID,
    providerRef: it.booking_token ?? it.departure_token,
    totalPrice: it.price,
    currency: (q.currency || "USD").trim().toUpperCase(),
    carrierCodes,
    stops: outbound.stops,
    durationMins,
    outbound,
    inbound: undefined,
    bookingUrl: googleFlightsUrl(q),
    // SerpApi results have no hard expiry; treat them as stale after 24h so
    // the UI can label them and the cache TTL governs refreshes.
    expiresAt: new Date(new Date(retrievedAt).getTime() + 24 * 3600 * 1000).toISOString(),
  }
}

const LEVELS: Record<string, PriceLevel> = { low: "LOW", typical: "TYPICAL", high: "HIGH" }

export function mapSerpApiPriceInsights(pi: SerpApiPriceInsights | undefined | null): PriceInsight | undefined {
  if (!pi || typeof pi.lowest_price !== "number") return undefined
  const range = Array.isArray(pi.typical_price_range) ? pi.typical_price_range : undefined
  return {
    lowestPrice: pi.lowest_price,
    typicalLow: range && typeof range[0] === "number" ? range[0] : undefined,
    typicalHigh: range && typeof range[1] === "number" ? range[1] : undefined,
    level: LEVELS[(pi.price_level ?? "").toLowerCase()] ?? "UNKNOWN",
  }
}

export function mapSerpApiResponse(
  json: SerpApiGoogleFlightsResponse,
  q: FlightQuery,
  retrievedAt: string = new Date().toISOString()
): ProviderSearchResult {
  const raw = [...(json.best_flights ?? []), ...(json.other_flights ?? [])]
  const offers = raw
    .map((it) => mapSerpApiItinerary(it, q, retrievedAt))
    .filter((o): o is FlightOfferResult => o !== null)
    .sort((a, b) => a.totalPrice - b.totalPrice)
  return {
    offers,
    insight: mapSerpApiPriceInsights(json.price_insights),
    retrievedAt,
    fromCache: false,
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

export interface SerpApiProviderDeps {
  /** Resolves the API key at call time so rotation needs no redeploy. */
  apiKey: () => Promise<string>
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class SerpApiProvider implements FlightProvider {
  readonly id = SERPAPI_PROVIDER_ID
  readonly supportsBooking = false

  constructor(private readonly deps: SerpApiProviderDeps) {}

  async search(q: FlightQuery): Promise<ProviderSearchResult> {
    const apiKey = (await this.deps.apiKey()).trim()
    if (!apiKey) throw new ProviderNotConfiguredError(this.id, "api.serpapi.key")

    const fetchImpl = this.deps.fetchImpl ?? fetch
    const params = buildSerpApiParams(q, apiKey)
    let res: Response
    try {
      res = await fetchImpl(`${SERPAPI_ENDPOINT}?${params.toString()}`, { cache: "no-store" })
    } catch (err) {
      throw new ProviderRequestError(this.id, err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ProviderRequestError(this.id, body.slice(0, 300) || res.statusText, res.status)
    }
    const json = (await res.json()) as SerpApiGoogleFlightsResponse
    if (json.error) throw new ProviderRequestError(this.id, json.error, res.status)
    return mapSerpApiResponse(json, q, (this.deps.now?.() ?? new Date()).toISOString())
  }
}
