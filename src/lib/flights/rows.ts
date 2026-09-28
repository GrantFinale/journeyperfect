/**
 * Converters between database row shapes and the domain types in ./types.
 * PURE: uses structural "row-like" types rather than Prisma's generated ones
 * so the cache, the views and Vitest can share them without touching the
 * Prisma client.
 */
import type { CabinClass, FlightItinerary, FlightOfferResult, FlightQuery, PriceInsight } from "./types"

export interface FlightSearchRowLike {
  id: string
  userId: string
  tripId: string | null
  origin: string
  destination: string
  departDate: Date
  returnDate: Date | null
  cabin: string
  adults: number
  children: number
  maxStops: number | null
  isTracking: boolean
  targetPrice: number | null
  currency: string
  lastCheckedAt: Date | null
  lastPrice: number | null
  lowestPrice: number | null
  queryHash: string
  createdAt: Date
  updatedAt: Date
}

export interface FlightOfferRowLike {
  id: string
  searchId: string
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
  capturedAt: Date
  expiresAt: Date | null
}

export interface FlightPricePointRowLike {
  price: number
  currency: string
  provider: string
  insight: unknown
  capturedAt: Date
}

const CABINS: readonly CabinClass[] = ["economy", "premium_economy", "business", "first"]

export function isCabinClass(value: unknown): value is CabinClass {
  return typeof value === "string" && (CABINS as readonly string[]).includes(value)
}

export function toCabinClass(value: string | null | undefined): CabinClass {
  return isCabinClass(value) ? value : "economy"
}

/** A `@db.Date` column comes back as UTC midnight; render it as YYYY-MM-DD. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Inverse of `toIsoDate` for writing a `@db.Date` column. */
export function fromIsoDate(isoDate: string): Date {
  return new Date(`${isoDate.trim()}T00:00:00.000Z`)
}

export function searchRowToQuery(row: FlightSearchRowLike): FlightQuery {
  return {
    origin: row.origin,
    destination: row.destination,
    departDate: toIsoDate(row.departDate),
    returnDate: row.returnDate ? toIsoDate(row.returnDate) : undefined,
    cabin: toCabinClass(row.cabin),
    adults: row.adults,
    children: row.children,
    maxStops: row.maxStops ?? undefined,
    currency: row.currency,
  }
}

function asItinerary(value: unknown): FlightItinerary | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Partial<FlightItinerary>
  if (!Array.isArray(v.segments)) return undefined
  return {
    segments: v.segments,
    durationMins: typeof v.durationMins === "number" ? v.durationMins : 0,
    stops: typeof v.stops === "number" ? v.stops : Math.max(0, v.segments.length - 1),
  }
}

export function offerRowToResult(row: FlightOfferRowLike): FlightOfferResult {
  const outbound = asItinerary(row.outbound) ?? { segments: [], durationMins: row.durationMins, stops: row.stops }
  return {
    provider: row.provider,
    providerRef: row.providerRef ?? undefined,
    totalPrice: row.totalPrice,
    currency: row.currency,
    carrierCodes: row.carrierCodes,
    stops: row.stops,
    durationMins: row.durationMins,
    outbound,
    inbound: asItinerary(row.inbound),
    bookingUrl: row.bookingUrl,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : undefined,
  }
}

/** Column values for a FlightOffer insert (caller adds `searchId`). */
export function offerResultToRow(offer: FlightOfferResult) {
  return {
    provider: offer.provider,
    providerRef: offer.providerRef ?? null,
    totalPrice: offer.totalPrice,
    currency: offer.currency,
    carrierCodes: offer.carrierCodes,
    stops: offer.stops,
    durationMins: offer.durationMins,
    outbound: offer.outbound,
    inbound: offer.inbound ?? null,
    bookingUrl: offer.bookingUrl,
    expiresAt: offer.expiresAt ? new Date(offer.expiresAt) : null,
  }
}

export function parseInsight(value: unknown): PriceInsight | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Partial<PriceInsight>
  if (typeof v.lowestPrice !== "number") return undefined
  return {
    lowestPrice: v.lowestPrice,
    typicalLow: typeof v.typicalLow === "number" ? v.typicalLow : undefined,
    typicalHigh: typeof v.typicalHigh === "number" ? v.typicalHigh : undefined,
    level: v.level ?? "UNKNOWN",
  }
}

/** Lowest total price across offers, or null when there are none. */
export function lowestOfferPrice(offers: readonly { totalPrice: number }[]): number | null {
  let min: number | null = null
  for (const o of offers) {
    if (Number.isFinite(o.totalPrice) && (min === null || o.totalPrice < min)) min = o.totalPrice
  }
  return min
}
