/**
 * Travelpayouts Data API v3 provider. Cached (up to ~7 days stale) prices,
 * no live availability, no booking; every offer deep-links to Aviasales with
 * our affiliate marker. Also exposes `getFareCalendar` (grouped_prices) for
 * stage 2 of the Opportunity Discovery Engine.
 *
 * Mappers are pure and tested; credentials are injected.
 */
import type { FlightProvider } from "../provider"
import type { FlightItinerary, FlightOfferResult, FlightQuery, FlightSegment, ProviderSearchResult } from "../types"
import { ProviderNotConfiguredError, ProviderRequestError } from "../errors"
import { aviasalesUrl } from "../deeplinks"
import { formatLocalIso, toLocalIso, zonedTimeToUtc } from "../time"
import { getAirportCoords } from "../../airports"

export const TRAVELPAYOUTS_PROVIDER_ID = "travelpayouts"
export const TRAVELPAYOUTS_BASE = "https://api.travelpayouts.com"
export const AVIASALES_BASE = "https://www.aviasales.com"

// ─── Response shapes ───────────────────────────────────────────────────────

export interface TravelpayoutsPrice {
  origin?: string
  destination?: string
  origin_airport?: string
  destination_airport?: string
  /** Per passenger (one adult), in `currency` of the response. */
  price: number
  /** IATA carrier code */
  airline?: string
  flight_number?: string
  /** ISO 8601 with offset, e.g. "2026-12-01T10:00:00-05:00" */
  departure_at?: string
  return_at?: string
  transfers?: number
  return_transfers?: number
  /** total minutes (both directions for round trips) */
  duration?: number
  duration_to?: number
  duration_back?: number
  /** "/search/DTW0112MCO08121?t=..." relative Aviasales path */
  link?: string
}

export interface TravelpayoutsPricesResponse {
  success: boolean
  data?: TravelpayoutsPrice[]
  currency?: string
  error?: string
}

export interface TravelpayoutsGroupedResponse {
  success: boolean
  data?: Record<string, TravelpayoutsPrice>
  currency?: string
  error?: string
}

export interface FareCalendarEntry {
  /** YYYY-MM-DD departure date */
  date: string
  /** Per-passenger price */
  price: number
  currency: string
  airline: string | null
  transfers: number
  /** Aviasales deep link with marker */
  url: string
}

// ─── Query mapping ─────────────────────────────────────────────────────────

export function buildPricesForDatesParams(q: FlightQuery, token: string): URLSearchParams {
  const params = new URLSearchParams({
    origin: q.origin.trim().toUpperCase(),
    destination: q.destination.trim().toUpperCase(),
    departure_at: q.departDate.trim(),
    one_way: q.returnDate ? "false" : "true",
    direct: q.maxStops === 0 ? "true" : "false",
    currency: (q.currency || "USD").trim().toLowerCase(),
    sorting: "price",
    limit: "30",
    page: "1",
    unique: "false",
    token,
  })
  if (q.returnDate) params.set("return_at", q.returnDate.trim())
  return params
}

export function buildGroupedPricesParams(origin: string, destination: string, month: string, currency: string, token: string): URLSearchParams {
  return new URLSearchParams({
    origin: origin.trim().toUpperCase(),
    destination: destination.trim().toUpperCase(),
    departure_at: month.trim().slice(0, 7),
    group_by: "departure_at",
    currency: currency.trim().toLowerCase(),
    token,
  })
}

// ─── Response mapping ──────────────────────────────────────────────────────

export function aviasalesLinkFromPath(link: string | undefined, q: FlightQuery, marker: string | null | undefined): string {
  if (link && link.startsWith("/")) {
    const sep = link.includes("?") ? "&" : "?"
    return `${AVIASALES_BASE}${link}${marker ? `${sep}marker=${encodeURIComponent(marker)}` : ""}`
  }
  return aviasalesUrl(q, marker)
}

/**
 * Travelpayouts describes a direction as one record (carrier, departure,
 * duration, transfer count) without intermediate airports, so each direction
 * becomes a single synthetic segment. `stops` still carries the transfer count
 * so the UI can show "1 stop".
 */
function directionItinerary(from: string, to: string, departAt: string | undefined, durationMins: number, stops: number, carrier: string, flightNumber: string | undefined): FlightItinerary | undefined {
  if (!departAt) return undefined
  const fromTz = getAirportCoords(from)?.tz
  const toTz = getAirportCoords(to)?.tz
  const departLocal = toLocalIso(departAt)
  const departUtc = zonedTimeToUtc(departAt, fromTz)
  const arriveLocal = isNaN(departUtc.getTime())
    ? departLocal
    : formatLocalIso(new Date(departUtc.getTime() + durationMins * 60000), toTz ?? fromTz)
  const segment: FlightSegment = {
    carrier,
    flightNumber: flightNumber ? `${carrier} ${flightNumber}`.trim() : undefined,
    from,
    to,
    departAt: departLocal,
    arriveAt: arriveLocal,
    durationMins,
  }
  return { segments: [segment], durationMins, stops }
}

export function mapTravelpayoutsPrice(item: TravelpayoutsPrice, q: FlightQuery, currency: string, marker: string | null | undefined, retrievedAt: string): FlightOfferResult | null {
  if (typeof item.price !== "number" || !Number.isFinite(item.price)) return null
  const origin = (item.origin_airport ?? item.origin ?? q.origin).trim().toUpperCase()
  const destination = (item.destination_airport ?? item.destination ?? q.destination).trim().toUpperCase()
  const carrier = (item.airline ?? "??").trim().toUpperCase()
  const outMins = item.duration_to ?? (q.returnDate ? 0 : item.duration ?? 0)
  const backMins = item.duration_back ?? 0
  const outbound = directionItinerary(origin, destination, item.departure_at, outMins, item.transfers ?? 0, carrier, item.flight_number)
  if (!outbound) return null
  const inbound = q.returnDate ? directionItinerary(destination, origin, item.return_at, backMins, item.return_transfers ?? 0, carrier, undefined) : undefined

  const pax = Math.max(1, (q.adults || 1) + (q.children || 0))
  const durationMins = item.duration && item.duration > 0 ? item.duration : outMins + (inbound ? backMins : 0)

  return {
    provider: TRAVELPAYOUTS_PROVIDER_ID,
    totalPrice: Math.round(item.price * pax * 100) / 100,
    currency: currency.toUpperCase(),
    carrierCodes: carrier === "??" ? [] : [carrier],
    stops: Math.max(outbound.stops, inbound?.stops ?? 0),
    durationMins,
    outbound,
    inbound,
    bookingUrl: aviasalesLinkFromPath(item.link, q, marker),
    // Data API prices are cached up to a week on their side.
    expiresAt: new Date(new Date(retrievedAt).getTime() + 7 * 24 * 3600 * 1000).toISOString(),
  }
}

export function mapTravelpayoutsPrices(
  json: TravelpayoutsPricesResponse,
  q: FlightQuery,
  marker: string | null | undefined,
  retrievedAt: string = new Date().toISOString()
): ProviderSearchResult {
  const currency = (json.currency ?? q.currency ?? "USD").toUpperCase()
  const offers = (json.data ?? [])
    .map((item) => mapTravelpayoutsPrice(item, q, currency, marker, retrievedAt))
    .filter((o): o is FlightOfferResult => o !== null)
    .sort((a, b) => a.totalPrice - b.totalPrice)
  return { offers, insight: undefined, retrievedAt, fromCache: false }
}

export function mapGroupedPrices(json: TravelpayoutsGroupedResponse, origin: string, destination: string, marker: string | null | undefined, fallbackCurrency = "USD"): FareCalendarEntry[] {
  const currency = (json.currency ?? fallbackCurrency).toUpperCase()
  const out: FareCalendarEntry[] = []
  for (const [date, item] of Object.entries(json.data ?? {})) {
    if (!item || typeof item.price !== "number" || !Number.isFinite(item.price)) continue
    const q: FlightQuery = { origin, destination, departDate: date, cabin: "economy", adults: 1, children: 0, currency }
    out.push({
      date,
      price: item.price,
      currency,
      airline: item.airline ? item.airline.toUpperCase() : null,
      transfers: item.transfers ?? 0,
      url: aviasalesLinkFromPath(item.link, q, marker),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Provider ──────────────────────────────────────────────────────────────

export interface TravelpayoutsDeps {
  token: () => Promise<string>
  marker: () => Promise<string>
  fetchImpl?: typeof fetch
  now?: () => Date
}

async function getJson<T>(deps: TravelpayoutsDeps, path: string, params: URLSearchParams): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${TRAVELPAYOUTS_BASE}${path}?${params.toString()}`, { cache: "no-store" })
  } catch (err) {
    throw new ProviderRequestError(TRAVELPAYOUTS_PROVIDER_ID, err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new ProviderRequestError(TRAVELPAYOUTS_PROVIDER_ID, body.slice(0, 300) || res.statusText, res.status)
  }
  const json = (await res.json()) as T & { success?: boolean; error?: string }
  if (json.success === false) throw new ProviderRequestError(TRAVELPAYOUTS_PROVIDER_ID, json.error ?? "success=false", res.status)
  return json
}

export class TravelpayoutsProvider implements FlightProvider {
  readonly id = TRAVELPAYOUTS_PROVIDER_ID
  readonly supportsBooking = false

  constructor(private readonly deps: TravelpayoutsDeps) {}

  async search(q: FlightQuery): Promise<ProviderSearchResult> {
    const token = (await this.deps.token()).trim()
    if (!token) throw new ProviderNotConfiguredError(this.id, "api.travelpayouts.token")
    const marker = (await this.deps.marker()).trim() || null
    const json = await getJson<TravelpayoutsPricesResponse>(this.deps, "/aviasales/v3/prices_for_dates", buildPricesForDatesParams(q, token))
    return mapTravelpayoutsPrices(json, q, marker, (this.deps.now?.() ?? new Date()).toISOString())
  }

  /**
   * Cheapest fare per departure day in `month` ("YYYY-MM"). Returns [] when
   * the token is missing so the opportunities pipeline degrades to no
   * airfare signal rather than failing.
   */
  async getFareCalendar(origin: string, destination: string, month: string, currency = "USD"): Promise<FareCalendarEntry[]> {
    const token = (await this.deps.token()).trim()
    if (!token) return []
    const marker = (await this.deps.marker()).trim() || null
    const json = await getJson<TravelpayoutsGroupedResponse>(this.deps, "/aviasales/v3/grouped_prices", buildGroupedPricesParams(origin, destination, month, currency, token))
    return mapGroupedPrices(json, origin, destination, marker, currency)
  }
}

export interface FareCalendarArgs {
  origin: string
  destination: string
  /** "YYYY-MM"; defaults to next month. */
  month?: string
  /** ISO 4217; default USD */
  currency?: string
}

export interface FareCalendar {
  source: "travelpayouts"
  origin: string
  destination: string
  month: string
  currency: string
  /** ISO 8601 */
  retrievedAt: string
  /** Cheapest fare per departure date, ascending by date. Empty when unconfigured or no data. */
  days: FareCalendarEntry[]
  cheapest: FareCalendarEntry | null
  /** Set when the Data API token is missing; the pipeline degrades to no airfare signal. */
  unavailableReason?: string
}

function defaultMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * Stage-2 fare calendar for the opportunities engine and the AI trip-proposal
 * tool loop (src/lib/actions/trip-proposals.ts). Reads
 * `api.travelpayouts.token` / `api.travelpayouts.marker` from config via a
 * lazy import so this module stays importable without Prisma in tests. Never
 * throws for missing config: returns an empty calendar with
 * `unavailableReason` instead.
 */
export async function getFareCalendar(args: FareCalendarArgs): Promise<FareCalendar> {
  const origin = args.origin.trim().toUpperCase()
  const destination = args.destination.trim().toUpperCase()
  const month = (args.month ?? defaultMonth()).trim().slice(0, 7)
  const currency = (args.currency ?? "USD").trim().toUpperCase()
  const base: FareCalendar = { source: "travelpayouts", origin, destination, month, currency, retrievedAt: new Date().toISOString(), days: [], cheapest: null }

  const { getConfigKey } = await import("@/lib/config-keys")
  const provider = new TravelpayoutsProvider({
    token: () => getConfigKey("api.travelpayouts.token"),
    marker: () => getConfigKey("api.travelpayouts.marker"),
  })
  if (!(await getConfigKey("api.travelpayouts.token")).trim()) {
    return { ...base, unavailableReason: "api.travelpayouts.token is not configured" }
  }
  const days = await provider.getFareCalendar(origin, destination, month, currency)
  const cheapest = days.reduce<FareCalendarEntry | null>((best, d) => (best === null || d.price < best.price ? d : best), null)
  return { ...base, days, cheapest }
}
