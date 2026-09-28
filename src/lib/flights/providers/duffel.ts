/**
 * Duffel provider (NDC search, live prices, real booking). The only provider
 * with `supportsBooking = true`; orders are created in ../booking.ts.
 *
 * Cost note: Duffel charges per search beyond a 1500:1 look-to-book ratio, so
 * this provider must only ever be reached through the cache in ../index.ts.
 */
import { Duffel } from "@duffel/api"
import type { Offer, OfferSlice, OfferSliceSegment, CabinClass as DuffelCabin, CreateOfferRequestPassenger } from "@duffel/api/types"
import type { FlightProvider } from "../provider"
import type { FlightItinerary, FlightOfferResult, FlightQuery, FlightSegment, ProviderSearchResult } from "../types"
import { ProviderNotConfiguredError, ProviderRequestError } from "../errors"
import { googleFlightsUrl } from "../deeplinks"
import { isoDurationToMinutes, minutesBetween, toLocalIso } from "../time"
import { getAirportCoords } from "../../airports"

export const DUFFEL_PROVIDER_ID = "duffel"
/** Duffel returns many near-duplicate fare brands; keep the cheapest N. */
export const DUFFEL_MAX_OFFERS = 40
/** Duffel needs an age for child passengers; the UI only gives a count. */
const DEFAULT_CHILD_AGE = 8

type DuffelOffer = Omit<Offer, "available_services">

function mapSegment(seg: OfferSliceSegment): FlightSegment | null {
  const from = seg.origin?.iata_code?.toUpperCase()
  const to = seg.destination?.iata_code?.toUpperCase()
  if (!from || !to || !seg.departing_at || !seg.arriving_at) return null
  const carrier = (seg.marketing_carrier?.iata_code ?? seg.operating_carrier?.iata_code ?? "??").toUpperCase()
  const departAt = toLocalIso(seg.departing_at)
  const arriveAt = toLocalIso(seg.arriving_at)
  const durationMins = isoDurationToMinutes(seg.duration) || minutesBetween(departAt, getAirportCoords(from)?.tz, arriveAt, getAirportCoords(to)?.tz)
  return {
    carrier,
    carrierName: seg.marketing_carrier?.name ?? seg.operating_carrier?.name,
    flightNumber: seg.marketing_carrier_flight_number ? `${carrier} ${seg.marketing_carrier_flight_number}` : undefined,
    from,
    to,
    departAt,
    arriveAt,
    durationMins,
  }
}

function mapSlice(slice: OfferSlice): FlightItinerary | null {
  const segments = (slice.segments ?? []).map(mapSegment).filter((s): s is FlightSegment => s !== null)
  if (segments.length === 0) return null
  const first = segments[0]
  const last = segments[segments.length - 1]
  const durationMins =
    isoDurationToMinutes(slice.duration) ||
    minutesBetween(first.departAt, getAirportCoords(first.from)?.tz, last.arriveAt, getAirportCoords(last.to)?.tz)
  return { segments, durationMins, stops: segments.length - 1 }
}

export function mapDuffelOffer(offer: DuffelOffer, q: FlightQuery): FlightOfferResult | null {
  const slices = (offer.slices ?? []).map(mapSlice)
  const outbound = slices[0]
  if (!outbound) return null
  const inbound = slices[1] ?? undefined
  const totalPrice = Number.parseFloat(offer.total_amount)
  if (!Number.isFinite(totalPrice)) return null
  const carrierCodes = [...new Set([outbound, ...(inbound ? [inbound] : [])].flatMap((i) => i.segments.map((s) => s.carrier)).filter((c) => c !== "??"))]
  if (carrierCodes.length === 0 && offer.owner?.iata_code) carrierCodes.push(offer.owner.iata_code.toUpperCase())
  return {
    provider: DUFFEL_PROVIDER_ID,
    providerRef: offer.id,
    totalPrice,
    currency: (offer.total_currency ?? q.currency).toUpperCase(),
    carrierCodes,
    stops: Math.max(outbound.stops, inbound?.stops ?? 0),
    durationMins: outbound.durationMins + (inbound?.durationMins ?? 0),
    outbound,
    inbound,
    // No consumer-facing Duffel URL exists; booking is in-app (booking.ts) and
    // the handoff fallback is Google Flights.
    bookingUrl: googleFlightsUrl(q),
    expiresAt: offer.expires_at,
  }
}

export function mapDuffelOffers(offers: readonly DuffelOffer[], q: FlightQuery, retrievedAt: string = new Date().toISOString()): ProviderSearchResult {
  const mapped = offers
    .map((o) => mapDuffelOffer(o, q))
    .filter((o): o is FlightOfferResult => o !== null)
    .sort((a, b) => a.totalPrice - b.totalPrice)
    .slice(0, DUFFEL_MAX_OFFERS)
  return { offers: mapped, insight: undefined, retrievedAt, fromCache: false }
}

export function buildDuffelPassengers(q: FlightQuery): CreateOfferRequestPassenger[] {
  const passengers: CreateOfferRequestPassenger[] = []
  for (let i = 0; i < Math.max(1, q.adults); i++) passengers.push({ type: "adult" })
  for (let i = 0; i < Math.max(0, q.children); i++) passengers.push({ age: DEFAULT_CHILD_AGE })
  return passengers
}

function maxConnections(maxStops: number | undefined): 0 | 1 | 2 | undefined {
  if (maxStops === undefined || maxStops === null || maxStops < 0) return undefined
  if (maxStops >= 2) return 2
  return maxStops as 0 | 1
}

export interface DuffelProviderDeps {
  token: () => Promise<string>
  now?: () => Date
  /** Test seam: replaces the SDK client factory. */
  clientFactory?: (token: string) => Pick<Duffel, "offerRequests">
}

export function createDuffelClient(token: string): Duffel {
  return new Duffel({ token, source: "journeyperfect" })
}

export class DuffelProvider implements FlightProvider {
  readonly id = DUFFEL_PROVIDER_ID
  readonly supportsBooking = true

  constructor(private readonly deps: DuffelProviderDeps) {}

  async search(q: FlightQuery): Promise<ProviderSearchResult> {
    const token = (await this.deps.token()).trim()
    if (!token) throw new ProviderNotConfiguredError(this.id, "api.duffel.token")
    const client = (this.deps.clientFactory ?? createDuffelClient)(token)

    const slices = [
      { origin: q.origin.trim().toUpperCase(), destination: q.destination.trim().toUpperCase(), departure_date: q.departDate.trim(), departure_time: null, arrival_time: null },
    ]
    if (q.returnDate) {
      slices.push({ origin: q.destination.trim().toUpperCase(), destination: q.origin.trim().toUpperCase(), departure_date: q.returnDate.trim(), departure_time: null, arrival_time: null })
    }

    try {
      const res = await client.offerRequests.create({
        slices,
        passengers: buildDuffelPassengers(q),
        cabin_class: q.cabin as DuffelCabin,
        max_connections: maxConnections(q.maxStops),
        return_offers: true,
      })
      return mapDuffelOffers(res.data.offers ?? [], q, (this.deps.now?.() ?? new Date()).toISOString())
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err
      const e = err as { message?: string; meta?: { status?: number }; errors?: { message?: string }[] }
      const message = e.errors?.[0]?.message ?? e.message ?? String(err)
      throw new ProviderRequestError(this.id, message, e.meta?.status)
    }
  }
}
