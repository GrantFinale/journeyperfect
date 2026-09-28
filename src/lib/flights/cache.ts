/**
 * Postgres-backed result cache keyed on `queryHash`. The FlightSearch row is
 * the key holder (any row with that hash, freshest `lastCheckedAt` wins) and
 * its FlightOffer children are the cached offers. TTL comes from
 * `flights.cacheTtlHours`. See docs/plans/flights-search-tracking-and-booking.md §4.2:
 * "Cache before every provider call" is the cost control, the rate-limit
 * defence and the ToS posture all at once.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import type { ProviderSearchResult } from "./types"
import { lowestOfferPrice, offerResultToRow, offerRowToResult, parseInsight } from "./rows"

export interface CachedSearch {
  /** The FlightSearch row the cached offers hang off (may belong to another user). */
  searchId: string
  result: ProviderSearchResult
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

/**
 * Freshest cached result for `hash`, or null when nothing was checked within
 * `ttlHours`. An empty offer list is still a valid hit: "no flights" is an
 * answer we paid for.
 */
export async function getCached(hash: string, ttlHours: number): Promise<CachedSearch | null> {
  const ttl = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 6
  const cutoff = new Date(Date.now() - ttl * 3600 * 1000)
  const search = await prisma.flightSearch.findFirst({
    where: { queryHash: hash, lastCheckedAt: { gte: cutoff } },
    orderBy: { lastCheckedAt: "desc" },
    include: {
      offers: { orderBy: { totalPrice: "asc" } },
      pricePoints: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  })
  if (!search || !search.lastCheckedAt) return null
  return {
    searchId: search.id,
    result: {
      offers: search.offers.map(offerRowToResult),
      insight: parseInsight(search.pricePoints[0]?.insight),
      retrievedAt: search.lastCheckedAt.toISOString(),
      fromCache: true,
    },
  }
}

/**
 * Replace the offers under `searchId` with `result.offers` and stamp
 * `lastCheckedAt`. Also records one FlightPricePoint (lowest price + insight)
 * when `recordPricePoint` is set and at least one offer exists, and rolls
 * `lastPrice` / `lowestPrice` forward.
 */
export async function putCached(
  searchId: string,
  result: ProviderSearchResult,
  opts: { provider: string; recordPricePoint?: boolean } = { provider: "unknown", recordPricePoint: true }
): Promise<{ lowestPrice: number | null }> {
  const checkedAt = new Date(result.retrievedAt)
  const lowest = lowestOfferPrice(result.offers)
  const currency = result.offers[0]?.currency

  const existing = await prisma.flightSearch.findUnique({
    where: { id: searchId },
    select: { lowestPrice: true, currency: true },
  })
  if (!existing) return { lowestPrice: lowest }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.flightOffer.deleteMany({ where: { searchId } }),
  ]
  if (result.offers.length > 0) {
    ops.push(
      prisma.flightOffer.createMany({
        data: result.offers.map((o) => {
          const row = offerResultToRow(o)
          return {
            searchId,
            ...row,
            outbound: toJson(row.outbound),
            inbound: row.inbound ? toJson(row.inbound) : Prisma.JsonNull,
          }
        }),
      })
    )
  }
  if (opts.recordPricePoint !== false && lowest !== null) {
    ops.push(
      prisma.flightPricePoint.create({
        data: {
          searchId,
          price: lowest,
          currency: currency ?? existing.currency,
          provider: opts.provider,
          insight: result.insight ? toJson(result.insight) : Prisma.JsonNull,
          capturedAt: checkedAt,
        },
      })
    )
  }
  const newLowest = lowest === null ? existing.lowestPrice : existing.lowestPrice === null ? lowest : Math.min(existing.lowestPrice, lowest)
  ops.push(
    prisma.flightSearch.update({
      where: { id: searchId },
      data: {
        lastCheckedAt: checkedAt,
        ...(lowest !== null ? { lastPrice: lowest } : {}),
        ...(newLowest !== null ? { lowestPrice: newLowest } : {}),
      },
    })
  )
  await prisma.$transaction(ops)
  return { lowestPrice: newLowest }
}
