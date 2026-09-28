"use server"

/**
 * Flight search server actions. The UI (src/app/(app)/trip/[tripId]/flights/)
 * codes against exactly these seven exports; view types live in
 * src/lib/flights/views.ts. Provider choice never leaks past
 * src/lib/flights/index.ts.
 */
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { getConfigKey } from "@/lib/config-keys"
import { requireTripAccess } from "@/lib/auth-trip"
import { hasFeature, getUpgradeMessage } from "@/lib/features"
import { getDynamicPlanLimits, type Plan } from "@/lib/plans"
import { AIRPORT_COORDS, getAirportCoords } from "@/lib/airports"
import { createFlightWithItinerary, type FlightRecordInput } from "@/lib/flight-records"
import type { FlightItinerary, FlightQuery, PriceInsight } from "@/lib/flights/types"
import { normaliseFlightQuery, queryHash } from "@/lib/flights/types"
import { searchWithCache, isProviderNotConfigured } from "@/lib/flights"
import { airlineName, airlineSearchUrl, aviasalesUrl, googleFlightsUrl } from "@/lib/flights/deeplinks"
import { lowestOfferPrice, searchRowToQuery, toCabinClass } from "@/lib/flights/rows"
import { zonedTimeToUtc } from "@/lib/flights/time"
import {
  offerRowToView,
  pricePointRowToView,
  searchRowToSummary,
  type FlightOfferView,
  type FlightPricePointView,
  type FlightSearchSummary,
} from "@/lib/flights/views"

/** App-wide ceiling on distinct new searches per user per UTC day (provider spend guard). */
const DAILY_SEARCH_KEY = "flights.perUserDailySearches"
const DAILY_SEARCH_DEFAULT = "30"
/** Nearest-airport radius for suggestTripFlightQuery. */
const AIRPORT_RADIUS_KM = 150

// ─── Helpers ───────────────────────────────────────────────────────────────

async function requireUser(): Promise<{ id: string; plan: Plan }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, plan: true } })
  if (!user) throw new Error("Unauthorized")
  return { id: user.id, plan: user.plan as Plan }
}

/** Owner of the search, or a collaborator on the trip it belongs to. */
async function requireSearchAccess(searchId: string, userId: string, role: "VIEWER" | "EDITOR" = "VIEWER") {
  const search = await prisma.flightSearch.findUnique({ where: { id: searchId } })
  if (!search) throw new Error("Search not found")
  if (search.userId !== userId) {
    if (!search.tripId) throw new Error("Search not found")
    await requireTripAccess(search.tripId, role)
  }
  return search
}

function validateQuery(q: FlightQuery): FlightQuery {
  const n = normaliseFlightQuery(q)
  const iata = /^[A-Z]{3}$/
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (!iata.test(n.origin) || !iata.test(n.destination)) throw new Error("Origin and destination must be 3-letter IATA airport codes")
  if (n.origin === n.destination) throw new Error("Origin and destination must differ")
  if (!date.test(n.departDate)) throw new Error("Departure date must be YYYY-MM-DD")
  if (n.returnDate && (!date.test(n.returnDate) || n.returnDate < n.departDate)) throw new Error("Return date must be YYYY-MM-DD and on or after departure")
  if (!Number.isInteger(n.adults) || n.adults < 1 || n.adults > 9) throw new Error("Adults must be between 1 and 9")
  if (!Number.isInteger(n.children) || n.children < 0 || n.children > 8) throw new Error("Children must be between 0 and 8")
  return {
    origin: n.origin,
    destination: n.destination,
    departDate: n.departDate,
    returnDate: n.returnDate ?? undefined,
    cabin: toCabinClass(n.cabin),
    adults: n.adults,
    children: n.children,
    maxStops: n.maxStops ?? undefined,
    currency: /^[A-Z]{3}$/.test(n.currency) ? n.currency : "USD",
  }
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function nearestAirport(lat: number | null | undefined, lng: number | null | undefined, maxKm = AIRPORT_RADIUS_KM): string | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  let best: { code: string; km: number } | null = null
  for (const [code, a] of Object.entries(AIRPORT_COORDS)) {
    const km = haversineKm(lat, lng, a.lat, a.lng)
    if (km <= maxKm && (!best || km < best.km)) best = { code, km }
  }
  return best?.code ?? null
}

function revalidateTrip(tripId: string | null) {
  if (!tripId) return
  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/flights`)
  revalidatePath(`/trip/${tripId}/itinerary`)
}

// ─── Actions ───────────────────────────────────────────────────────────────

export async function searchFlights(
  tripId: string | null,
  q: FlightQuery
): Promise<{ searchId: string; offers: FlightOfferView[]; insight?: PriceInsight; fromCache: boolean; retrievedAt: string }> {
  const user = await requireUser()
  if (!hasFeature(user.plan, "flightSearch")) throw new Error(`UPGRADE_REQUIRED:${getUpgradeMessage("flightSearch")}`)
  // A search attached to a trip writes FlightSearch/FlightOffer rows visible on
  // that trip's Flights page, so it needs edit rights, not just view.
  if (tripId) await requireTripAccess(tripId, "EDITOR")
  const query = validateQuery(q)

  // Daily cap counts distinct new queries; repeating a query reuses its row
  // and the cache, so it costs nothing and is not counted.
  const cap = parseInt(await getConfig(DAILY_SEARCH_KEY, DAILY_SEARCH_DEFAULT), 10)
  if (Number.isFinite(cap) && cap > 0) {
    const today = await prisma.flightSearch.count({ where: { userId: user.id, createdAt: { gte: startOfUtcDay() } } })
    const existing = await prisma.flightSearch.findFirst({
      where: { userId: user.id, queryHash: queryHash(query) },
      select: { id: true },
    })
    if (!existing && today >= cap) throw new Error(`RATE_LIMITED:You have reached today's limit of ${cap} new flight searches. Try again tomorrow.`)
  }

  let searched
  try {
    searched = await searchWithCache(query, { userId: user.id, tripId })
  } catch (err) {
    if (isProviderNotConfigured(err)) {
      console.error("[flight-search]", err)
      throw new Error("FLIGHTS_NOT_CONFIGURED:Flight search is not set up yet. An administrator needs to add a provider API key in Settings.")
    }
    throw err
  }

  const rows = await prisma.flightOffer.findMany({ where: { searchId: searched.searchId }, orderBy: { totalPrice: "asc" } })
  revalidateTrip(tripId)
  return {
    searchId: searched.searchId,
    offers: rows.map(offerRowToView),
    insight: searched.result.insight,
    fromCache: searched.result.fromCache,
    retrievedAt: searched.result.retrievedAt,
  }
}

export async function getFlightSearchesForTrip(tripId: string): Promise<FlightSearchSummary[]> {
  await requireTripAccess(tripId, "VIEWER")
  const rows = await prisma.flightSearch.findMany({
    where: { tripId },
    orderBy: [{ isTracking: "desc" }, { updatedAt: "desc" }],
    include: { _count: { select: { offers: true } } },
  })
  return rows.map((row) => searchRowToSummary(row, row._count.offers))
}

export async function getFlightSearch(
  searchId: string
): Promise<{ search: FlightSearchSummary; offers: FlightOfferView[]; pricePoints: FlightPricePointView[] } | null> {
  const user = await requireUser()
  let search
  try {
    search = await requireSearchAccess(searchId, user.id)
  } catch {
    return null
  }
  const [offers, pricePoints] = await Promise.all([
    prisma.flightOffer.findMany({ where: { searchId }, orderBy: { totalPrice: "asc" } }),
    prisma.flightPricePoint.findMany({ where: { searchId }, orderBy: { capturedAt: "asc" } }),
  ])
  return {
    search: searchRowToSummary(search, offers.length),
    offers: offers.map(offerRowToView),
    pricePoints: pricePoints.map(pricePointRowToView),
  }
}

export async function setFlightTracking(
  searchId: string,
  isTracking: boolean,
  targetPrice?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser()
    if (!hasFeature(user.plan, "flightPriceTracking")) return { ok: false, error: getUpgradeMessage("flightPriceTracking") }
    // Tracking is a per-user quota, so only the search's owner may toggle it
    // (and the limit below is the owner's plan, i.e. this user's).
    const search = await prisma.flightSearch.findUnique({ where: { id: searchId } })
    if (!search || search.userId !== user.id) return { ok: false, error: "Only the person who ran this search can track it." }

    if (targetPrice !== undefined && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
      return { ok: false, error: "Target price must be a positive number" }
    }

    if (isTracking && !search.isTracking) {
      const limits = await getDynamicPlanLimits(user.plan)
      const active = await prisma.flightSearch.count({ where: { userId: user.id, isTracking: true, id: { not: searchId } } })
      if (active >= limits.maxFlightWatches) {
        return {
          ok: false,
          error: `Your ${limits.name} plan allows ${limits.maxFlightWatches} tracked route${limits.maxFlightWatches === 1 ? "" : "s"}. Stop tracking another route or upgrade to add more.`,
        }
      }
    }

    // Seed the baseline from the current offers so the first cron check has
    // something to compare against.
    let seed: { lastPrice?: number; lowestPrice?: number } = {}
    if (isTracking && (search.lastPrice === null || search.lowestPrice === null)) {
      const offers = await prisma.flightOffer.findMany({ where: { searchId }, select: { totalPrice: true } })
      const lowest = lowestOfferPrice(offers)
      if (lowest !== null) seed = { lastPrice: search.lastPrice ?? lowest, lowestPrice: search.lowestPrice ?? lowest }
    }

    await prisma.flightSearch.update({
      where: { id: searchId },
      data: {
        isTracking,
        ...(targetPrice !== undefined ? { targetPrice } : {}),
        ...seed,
      },
    })
    revalidateTrip(search.tripId)
    return { ok: true }
  } catch (err) {
    console.error("[flight-search] setFlightTracking failed:", err)
    return { ok: false, error: "Could not update tracking. Please try again." }
  }
}

function asItinerary(value: unknown): FlightItinerary | null {
  if (!value || typeof value !== "object") return null
  const v = value as Partial<FlightItinerary>
  return Array.isArray(v.segments) && v.segments.length > 0 ? (v as FlightItinerary) : null
}

function itineraryToFlightInput(
  itin: FlightItinerary,
  opts: { cabin: string; price: number | undefined; currency: string; bookingLink: string; notes: string }
): FlightRecordInput {
  const first = itin.segments[0]
  const last = itin.segments[itin.segments.length - 1]
  const depAirport = getAirportCoords(first.from)
  const arrAirport = getAirportCoords(last.to)
  const depTz = depAirport?.tz ?? "UTC"
  const arrTz = arrAirport?.tz ?? "UTC"
  const departureTime = zonedTimeToUtc(first.departAt, depTz)
  const arrivalTime = zonedTimeToUtc(last.arriveAt, arrTz)
  if (isNaN(departureTime.getTime()) || isNaN(arrivalTime.getTime())) throw new Error("Offer has unreadable departure or arrival times")
  return {
    airline: first.carrierName ?? airlineName(first.carrier) ?? first.carrier,
    flightNumber: first.flightNumber ?? undefined,
    departureAirport: first.from,
    departureCity: depAirport?.city,
    departureTime: departureTime.toISOString(),
    departureTimezone: depTz,
    arrivalAirport: last.to,
    arrivalCity: arrAirport?.city,
    arrivalTime: arrivalTime.toISOString(),
    arrivalTimezone: arrTz,
    bookingLink: opts.bookingLink,
    cabin: opts.cabin,
    notes: opts.notes,
    durationMins: itin.durationMins || undefined,
    price: opts.price,
    priceCurrency: opts.currency,
  }
}

/**
 * Turn an offer into booked-flight records: one Flight per direction, each
 * with its FLIGHT ItineraryItem (and budget item) via the shared
 * createFlightWithItinerary helper, so needsReservation, the To Do badge and
 * calendar export keep working unchanged. Passengers are left empty for the
 * user to assign.
 *
 * Without `targetTripId` the flights land on the search's own trip (the UI
 * path). With it — used when a speculative, unattached search is materialised
 * into a new trip by proposals / opportunities — the caller must own the
 * search and be able to edit the target trip.
 */
export async function acceptFlightOffer(
  searchId: string,
  offerId: string,
  targetTripId?: string
): Promise<{ flightIds: string[]; itineraryItemIds: string[] }> {
  const user = await requireUser()
  const search = await requireSearchAccess(searchId, user.id, "EDITOR")

  let tripId: string
  if (targetTripId) {
    if (search.userId !== user.id) throw new Error("Only the person who ran this search can add its flights to another trip.")
    await requireTripAccess(targetTripId, "EDITOR")
    tripId = targetTripId
  } else {
    if (!search.tripId) throw new Error("This search is not attached to a trip. Open it from a trip's Flights page to add flights.")
    await requireTripAccess(search.tripId, "EDITOR")
    tripId = search.tripId
  }

  const offer = await prisma.flightOffer.findFirst({ where: { id: offerId, searchId } })
  if (!offer) throw new Error("Offer not found")

  const outbound = asItinerary(offer.outbound)
  if (!outbound) throw new Error("Offer has no outbound itinerary")
  const inbound = asItinerary(offer.inbound)

  const directions = inbound ? [outbound, inbound] : [outbound]
  const share = Number.isFinite(offer.totalPrice) ? Math.round((offer.totalPrice / directions.length) * 100) / 100 : undefined
  const notes = `Found with JourneyPerfect flight search (${offer.provider}); price ${offer.currency} ${offer.totalPrice} captured ${offer.capturedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. Confirm the fare with the seller before booking.`

  const flightIds: string[] = []
  const itineraryItemIds: string[] = []
  for (const itin of directions) {
    const input = itineraryToFlightInput(itin, {
      cabin: search.cabin,
      price: share,
      currency: offer.currency,
      bookingLink: offer.bookingUrl,
      notes,
    })
    const { flight, itineraryItem } = await createFlightWithItinerary(tripId, input)
    flightIds.push(flight.id)
    itineraryItemIds.push(itineraryItem.id)
  }

  revalidateTrip(tripId)
  revalidatePath(`/trip/${tripId}/plan`)
  return { flightIds, itineraryItemIds }
}

const PROVIDER_LABEL: Record<string, string> = {
  serpapi: "Open in Google Flights",
  travelpayouts: "Compare on Aviasales",
  duffel: "Duffel offer (book in app)",
}

export async function getFlightBookingLinks(offerId: string): Promise<{ provider: string; url: string; label: string }[]> {
  const user = await requireUser()
  const offer = await prisma.flightOffer.findUnique({ where: { id: offerId } })
  if (!offer) throw new Error("Offer not found")
  const search = await requireSearchAccess(offer.searchId, user.id)
  const q = searchRowToQuery(search)
  const marker = (await getConfigKey("api.travelpayouts.marker")).trim() || null

  const links: { provider: string; url: string; label: string }[] = []
  const seen = new Set<string>()
  const push = (provider: string, url: string | null, label: string) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    links.push({ provider, url, label })
  }

  push(offer.provider, offer.bookingUrl, PROVIDER_LABEL[offer.provider] ?? "Open offer")
  push("google-flights", googleFlightsUrl(q), "Search on Google Flights")
  push("aviasales", aviasalesUrl(q, marker), "Compare on Aviasales")
  for (const carrier of offer.carrierCodes) {
    push(carrier.toLowerCase(), airlineSearchUrl(carrier, q), `Book direct with ${airlineName(carrier) ?? carrier}`)
  }
  return links
}

/**
 * Prefill a query from the trip: nearest airport (within 150 km) to the
 * origin and destination coordinates, trip dates, and traveller counts
 * (profiles tagged "child" count as children). Null when either airport is
 * unknown so the UI shows an empty form instead of a wrong one.
 */
export async function suggestTripFlightQuery(tripId: string): Promise<FlightQuery | null> {
  const { trip } = await requireTripAccess(tripId, "VIEWER")
  const origin = nearestAirport(trip.originLat, trip.originLng)
  const destination = nearestAirport(trip.destinationLat, trip.destinationLng)
  if (!origin || !destination || origin === destination) return null

  const travelers = await prisma.tripTraveler.findMany({
    where: { tripId },
    select: { traveler: { select: { tags: true, birthDate: true } } },
  })
  let adults = 0
  let children = 0
  for (const t of travelers) {
    const tags = t.traveler?.tags ?? []
    const birth = t.traveler?.birthDate
    const ageYears = birth ? (Date.now() - birth.getTime()) / (365.25 * 86400 * 1000) : null
    const isChild = tags.includes("child") || (ageYears !== null && ageYears < 12)
    if (isChild) children++
    else adults++
  }
  if (adults === 0) adults = 1

  const departDate = trip.startDate.toISOString().slice(0, 10)
  const endDate = trip.endDate.toISOString().slice(0, 10)
  return {
    origin,
    destination,
    departDate,
    returnDate: endDate > departDate ? endDate : undefined,
    cabin: "economy",
    adults: Math.min(adults, 9),
    children: Math.min(children, 8),
    currency: "USD",
  }
}
