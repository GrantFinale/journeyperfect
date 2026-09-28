/**
 * Serialisable view types returned by the flight-search server actions
 * (src/lib/actions/flight-search.ts). Every date is an ISO string so the
 * values cross the server/client boundary unchanged. PURE.
 */
import type { CabinClass, FlightItinerary } from "./types"
import {
  offerRowToResult,
  searchRowToQuery,
  toIsoDate,
  type FlightOfferRowLike,
  type FlightPricePointRowLike,
  type FlightSearchRowLike,
} from "./rows"

export interface FlightOfferView {
  id: string
  searchId: string
  /** "serpapi" | "duffel" | "travelpayouts" */
  provider: string
  providerRef: string | null
  totalPrice: number
  currency: string
  carrierCodes: string[]
  stops: number
  durationMins: number
  outbound: FlightItinerary
  inbound: FlightItinerary | null
  bookingUrl: string
  /** ISO 8601 */
  capturedAt: string
  /** ISO 8601; null when the offer does not expire */
  expiresAt: string | null
}

export interface FlightSearchSummary {
  id: string
  tripId: string | null
  origin: string
  destination: string
  /** YYYY-MM-DD */
  departDate: string
  /** YYYY-MM-DD; null for one-way */
  returnDate: string | null
  cabin: CabinClass
  adults: number
  children: number
  maxStops: number | null
  currency: string
  isTracking: boolean
  targetPrice: number | null
  /** ISO 8601 */
  lastCheckedAt: string | null
  lastPrice: number | null
  lowestPrice: number | null
  offerCount: number
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  updatedAt: string
}

export interface FlightPricePointView {
  price: number
  currency: string
  /** ISO 8601 */
  capturedAt: string
}

export function offerRowToView(row: FlightOfferRowLike): FlightOfferView {
  const r = offerRowToResult(row)
  return {
    id: row.id,
    searchId: row.searchId,
    provider: r.provider,
    providerRef: r.providerRef ?? null,
    totalPrice: r.totalPrice,
    currency: r.currency,
    carrierCodes: r.carrierCodes,
    stops: r.stops,
    durationMins: r.durationMins,
    outbound: r.outbound,
    inbound: r.inbound ?? null,
    bookingUrl: r.bookingUrl,
    capturedAt: row.capturedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

export function searchRowToSummary(row: FlightSearchRowLike, offerCount: number): FlightSearchSummary {
  const q = searchRowToQuery(row)
  return {
    id: row.id,
    tripId: row.tripId,
    origin: q.origin,
    destination: q.destination,
    departDate: q.departDate,
    returnDate: row.returnDate ? toIsoDate(row.returnDate) : null,
    cabin: q.cabin,
    adults: row.adults,
    children: row.children,
    maxStops: row.maxStops,
    currency: row.currency,
    isTracking: row.isTracking,
    targetPrice: row.targetPrice,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastPrice: row.lastPrice,
    lowestPrice: row.lowestPrice,
    offerCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function pricePointRowToView(row: FlightPricePointRowLike): FlightPricePointView {
  return { price: row.price, currency: row.currency, capturedAt: row.capturedAt.toISOString() }
}
