/**
 * Shared, provider-agnostic flight types. See
 * docs/plans/flights-search-tracking-and-booking.md §4.2.
 *
 * Server-safe (uses node:crypto) but deliberately free of Prisma imports so
 * the pure modules in this folder and their Vitest tests can import it.
 */
import { createHash } from "node:crypto"

export type CabinClass = "economy" | "premium_economy" | "business" | "first"

export interface FlightQuery {
  /** IATA airport code, e.g. "DTW" */
  origin: string
  /** IATA airport code, e.g. "MCO" */
  destination: string
  /** YYYY-MM-DD */
  departDate: string
  /** YYYY-MM-DD; omitted for one-way */
  returnDate?: string
  cabin: CabinClass
  adults: number
  children: number
  /** Undefined = any number of stops */
  maxStops?: number
  /** ISO 4217, e.g. "USD" */
  currency: string
}

export interface FlightSegment {
  /** IATA carrier code, e.g. "DL" */
  carrier: string
  carrierName?: string
  flightNumber?: string
  /** IATA airport code */
  from: string
  /** IATA airport code */
  to: string
  /** ISO 8601 local departure time */
  departAt: string
  /** ISO 8601 local arrival time */
  arriveAt: string
  durationMins: number
}

export interface FlightItinerary {
  segments: FlightSegment[]
  /** Total elapsed time including layovers */
  durationMins: number
  stops: number
}

/** One option a provider returned. Maps 1:1 onto the FlightOffer model. */
export interface FlightOfferResult {
  /** "serpapi" | "duffel" | "travelpayouts" */
  provider: string
  /** Provider-side offer id (Duffel offer id, needed to book) */
  providerRef?: string
  totalPrice: number
  currency: string
  carrierCodes: string[]
  /** Max stops across legs */
  stops: number
  /** Total duration across legs */
  durationMins: number
  outbound: FlightItinerary
  inbound?: FlightItinerary
  bookingUrl: string
  /** ISO 8601; Duffel offers expire, SerpApi ones just go stale */
  expiresAt?: string
}

export type PriceLevel = "LOW" | "TYPICAL" | "HIGH" | "UNKNOWN"

/** Google's price band for a route, when the provider returns it. */
export interface PriceInsight {
  lowestPrice: number
  typicalLow?: number
  typicalHigh?: number
  level: PriceLevel
}

export interface ProviderSearchResult {
  offers: FlightOfferResult[]
  insight?: PriceInsight
  /** ISO 8601 */
  retrievedAt: string
  fromCache: boolean
}

/** Normalised shape that participates in `queryHash`. */
export interface NormalisedFlightQuery {
  origin: string
  destination: string
  departDate: string
  returnDate: string | null
  cabin: CabinClass
  adults: number
  children: number
  maxStops: number | null
  currency: string
}

/**
 * Canonical form of a query: upper-cased codes, trimmed strings, explicit
 * nulls for optional fields, fixed key order.
 */
export function normaliseFlightQuery(q: FlightQuery): NormalisedFlightQuery {
  return {
    origin: q.origin.trim().toUpperCase(),
    destination: q.destination.trim().toUpperCase(),
    departDate: q.departDate.trim(),
    returnDate: q.returnDate?.trim() || null,
    cabin: q.cabin,
    adults: q.adults,
    children: q.children,
    maxStops: q.maxStops ?? null,
    currency: q.currency.trim().toUpperCase(),
  }
}

/**
 * Stable key for a query: sha1 of the normalised JSON. Two queries that
 * differ only in whitespace, case, or field order hash identically. Used as
 * `FlightSearch.queryHash` and as the cache key.
 */
export function queryHash(q: FlightQuery): string {
  const n = normaliseFlightQuery(q)
  const json = JSON.stringify([
    n.origin,
    n.destination,
    n.departDate,
    n.returnDate,
    n.cabin,
    n.adults,
    n.children,
    n.maxStops,
    n.currency,
  ])
  return createHash("sha1").update(json).digest("hex")
}
