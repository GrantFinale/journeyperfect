/**
 * Entry point for the flights layer. Nothing outside `src/lib/flights/` may
 * know which provider is active: `getFlightProvider()` reads
 * `flights.provider` from config, and `searchWithCache()` is the only way
 * callers should reach a provider. Server-only (Prisma via cache + config).
 */
import { prisma } from "@/lib/db"
import { getConfigKey, getConfigKeyNumber } from "@/lib/config-keys"
import type { FlightProvider } from "./provider"
import { isFlightProviderId } from "./provider"
import type { FlightOfferResult, FlightQuery, ProviderSearchResult } from "./types"
import { normaliseFlightQuery, queryHash } from "./types"
import { getCached, putCached } from "./cache"
import { fromIsoDate } from "./rows"
import { summariseNonstopObservations, unionSorted } from "./nonstop"
import { SerpApiProvider } from "./providers/serpapi"
import { TravelpayoutsProvider } from "./providers/travelpayouts"
import { DuffelProvider } from "./providers/duffel"

export { ProviderNotConfiguredError, ProviderRequestError, BookingDisabledError, isProviderNotConfigured } from "./errors"
export type { FlightProvider } from "./provider"

/** Build a provider instance by id. Keys resolve lazily at search time. */
export function createProvider(id: string): FlightProvider {
  switch (id) {
    case "duffel":
      return new DuffelProvider({ token: () => getConfigKey("api.duffel.token") })
    case "travelpayouts":
      return new TravelpayoutsProvider({
        token: () => getConfigKey("api.travelpayouts.token"),
        marker: () => getConfigKey("api.travelpayouts.marker"),
      })
    case "serpapi":
    default:
      return new SerpApiProvider({ apiKey: () => getConfigKey("api.serpapi.key") })
  }
}

/** The active provider per `flights.provider` (unknown values fall back to serpapi). */
export async function getFlightProvider(): Promise<FlightProvider> {
  const configured = (await getConfigKey("flights.provider")).trim().toLowerCase()
  return createProvider(isFlightProviderId(configured) ? configured : "serpapi")
}

/** Travelpayouts is always available for fare calendars regardless of the active provider. */
export function getTravelpayoutsProvider(): TravelpayoutsProvider {
  return createProvider("travelpayouts") as TravelpayoutsProvider
}

export interface SearchContext {
  userId: string
  tripId?: string | null
}

export interface SearchWithCacheResult {
  /** The caller's own FlightSearch row (offers are attached to it). */
  searchId: string
  result: ProviderSearchResult
  provider: string
}

/**
 * Find-or-create the user's FlightSearch for the query, then answer from the
 * cache (any user's fresh result for the same hash) or the provider. Every
 * provider run writes FlightOffer rows, one FlightPricePoint and rolls
 * lastPrice / lowestPrice forward; nonstop offers also feed NonstopRoute.
 *
 * `ctx.tripId` is only applied when the row is created (or is still
 * unattached): an existing search is never re-parented from one trip to
 * another, since collaborators on the first trip would silently lose it.
 */
export async function searchWithCache(q: FlightQuery, ctx: SearchContext): Promise<SearchWithCacheResult> {
  const n = normaliseFlightQuery(q)
  const hash = queryHash(q)

  let own = await prisma.flightSearch.findFirst({
    where: { userId: ctx.userId, queryHash: hash },
    orderBy: { updatedAt: "desc" },
  })
  if (!own) {
    own = await prisma.flightSearch.create({
      data: {
        userId: ctx.userId,
        tripId: ctx.tripId ?? null,
        origin: n.origin,
        destination: n.destination,
        departDate: fromIsoDate(n.departDate),
        returnDate: n.returnDate ? fromIsoDate(n.returnDate) : null,
        cabin: n.cabin,
        adults: n.adults,
        children: n.children,
        maxStops: n.maxStops,
        currency: n.currency,
        queryHash: hash,
      },
    })
  } else if (ctx.tripId && own.tripId === null) {
    own = await prisma.flightSearch.update({ where: { id: own.id }, data: { tripId: ctx.tripId } })
  }

  const ttlHours = await getConfigKeyNumber("flights.cacheTtlHours")
  const cached = await getCached(hash, ttlHours)
  if (cached) {
    const provider = cached.result.offers[0]?.provider ?? "cache"
    if (cached.searchId !== own.id) {
      // Copy the fresh offers onto the caller's row so offer ids exist for
      // accept/booking-link actions; the price point keeps this row's history
      // honest without a second provider call.
      await putCached(own.id, cached.result, { provider, recordPricePoint: true })
    }
    return { searchId: own.id, result: { ...cached.result, fromCache: true }, provider }
  }

  const provider = await getFlightProvider()
  const result = await provider.search(q)
  await putCached(own.id, result, { provider: provider.id, recordPricePoint: true })
  try {
    await recordObservedNonstopRoutes(result.offers)
  } catch (err) {
    console.error("[flights] recordObservedNonstopRoutes failed:", err)
  }
  return { searchId: own.id, result: { ...result, fromCache: false }, provider: provider.id }
}

/**
 * Upsert NonstopRoute rows for every nonstop leg observed in `offers`
 * (source "OBSERVED_OFFER"). Existing rows keep their source and gain the
 * union of carriers and departure buckets; duration is refreshed.
 */
export async function recordObservedNonstopRoutes(offers: readonly FlightOfferResult[]): Promise<number> {
  const observations = summariseNonstopObservations(offers)
  if (observations.length === 0) return 0
  const now = new Date()
  for (const obs of observations) {
    const existing = await prisma.nonstopRoute.findUnique({
      where: { originIata_destIata: { originIata: obs.originIata, destIata: obs.destIata } },
      select: { carriers: true, departureBuckets: true },
    })
    if (existing) {
      await prisma.nonstopRoute.update({
        where: { originIata_destIata: { originIata: obs.originIata, destIata: obs.destIata } },
        data: {
          carriers: unionSorted(existing.carriers, obs.carriers),
          departureBuckets: unionSorted(existing.departureBuckets, obs.departureBuckets),
          typicalDurationMins: obs.typicalDurationMins,
          lastVerifiedAt: now,
        },
      })
    } else {
      await prisma.nonstopRoute.create({
        data: {
          originIata: obs.originIata,
          destIata: obs.destIata,
          carriers: obs.carriers,
          departureBuckets: obs.departureBuckets,
          typicalDurationMins: obs.typicalDurationMins,
          source: "OBSERVED_OFFER",
          lastVerifiedAt: now,
        },
      })
    }
  }
  return observations.length
}
